/**
 * This is for debug.
 */
const forDebug = false; // If this is true, a log is output.
const toLog_ = (kind, text) => {
  const spreadsheetId = "###";
  const sheetName = "rawA2AAppLog";
  const sheet =
    SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  if (sheet) {
    sheet.appendRow([new Date(), kind, text]);
  }
};

/**
 * Class object for A2AApp.
 * This is used for building both an Agent2Agent (A2A) server and an A2A client with Google Apps Script.
 *
 * ### Usage Example
 * ```javascript
 * const agentCardUrls = [
 *   "https://public.agent.com",
 *   { "secure-agent": { "httpUrl": "https://secure.agent.com", "headers": { "X-Agent-Key": "my-secret" } } }
 * ];
 *
 * const app = new A2AApp({ model: "models/gemini-3-flash-preview" });
 * app.setServices({ lock: LockService.getScriptLock() });
 *
 * // --- Chat History Example ---
 * app.setHistory([
 *   { role: "user", parts: [{ text: "Hello, remember that I like apples." }] },
 *   { role: "model", parts: [{ text: "I will remember that you like apples." }] }
 * ]);
 *
 * const response = app.client({
 *   apiKey: "YOUR_GEMINI_API_KEY",
 *   prompt: "Ask the agent what my favorite fruit is.",
 *   agentCardUrls: agentCardUrls
 * });
 * console.log(response.result);
 * ```
 *
 * ### Important Note
 * If this script is used as a server (Web App), you MUST create a "New Deployment"
 * after updating the code. Otherwise, the old cached script will be executed.
 *
 * ### Execution Phases Logged:
 * - [Phase 1: Concurrency Control] LockService limits concurrent overlaps.
 * - [Phase 2: Agent Discovery] Retrieving `.well-known/agent-card.json`.
 * - [Phase 3: Tool Proxying] Dynamic schema conversion to Function Calling formats.
 * - [Phase 4: Planning] Gemini acts as a delegator to determine sequential routing.
 * - [Phase 5: Sequential Execution] Executing functions sequentially with forced routing.
 * - [Phase 6: Data Materialization] Isolating textual output from file blobs.
 * - [Phase 7: Final Synthesis] Generating the ultimate summarized response and Clean History.
 *
 * Author: Kanshi Tanaike
 * Refactored by: Senior Generative AI & MCP Expert
 * Version: 2.7.0 (Direct JSON-RPC Bypass Optimization)
 * GitHub: https://github.com/tanaikech/A2AApp
 * @class
 */
var A2AApp = class A2AApp {
  /**
   * @param {Object} object Configuration object.
   * @param {String} [object.accessKey] Access key for A2A server (optional).
   * @param {Boolean} [object.log] Enable logging to Google Sheets (default: false).
   * @param {String} [object.spreadsheetId] Spreadsheet ID for logs.
   * @param {String} [object.model] Model name (default: "models/gemini-3-flash-preview").
   */
  constructor(object = {}) {
    const { accessKey = null, log = false, spreadsheetId, model } = object;

    /** @private */
    this.accessKey = accessKey;

    /** @private */
    this.model = model || "models/gemini-3-flash-preview";

    /** @private */
    this.jsonrpc = "2.0";

    /** @private */
    this.date = new Date();

    /** @private */
    this.timezone = Session.getScriptTimeZone();

    /** @private */
    this.log = log;

    /** @private Context flag to dynamically adjust log direction values ("server" or "client") */
    this.contextType = "unknown";

    /** @private Chat history initialized array */
    this.history = [];

    if (this.log) {
      const ss = spreadsheetId
        ? SpreadsheetApp.openById(spreadsheetId)
        : SpreadsheetApp.create("Log_A2AApp");
      /** @private */
      this.sheet = ss.getSheetByName("log") || ss.insertSheet("log");
    }

    /** @private */
    this.values = [];

    /** @private */
    this.headers = { authorization: `Bearer ${ScriptApp.getOAuthToken()}` };

    /**
     * TaskState Enum
     * Ref: https://google.github.io/A2A/specification/#63-taskstate-enum
     * @private
     */
    this.TaskState = {
      submitted: "submitted",
      working: "working",
      input_required: "input-required",
      completed: "completed",
      canceled: "canceled",
      failed: "failed",
      unknown: "unknown",
    };

    /**
     * Error codes.
     * Ref: https://google.github.io/A2A/specification/#8-error-handling
     * @private
     */
    this.ErrorCode = {
      "Invalid JSON payload": -32700,
      "Invalid JSON-RPC Request": -32600,
      "Method not found": -32601,
      "Invalid method parameters": -32602,
      "Internal server error": -32603,
      "(Server-defined)": -32000,
      "Task not found": -32001,
      "Task cannot be canceled": -32002,
      "Push Notification is not supported": -32003,
      "This operation is not supported": -32004,
      "Incompatible content types": -32005,
      "Streaming is not supported": -32006,
      "Authentication required": -32007,
      "Authorization failed": -32008,
      "Invalid task state for operation": -32009,
      "Rate limit exceeded": -32010,
      "A required resource is unavailable": -32011,
    };

    // Initialize lock service (can be overridden by setServices)
    this.lock = this.lock || LockService.getScriptLock();
    this.properties =
      this.properties || PropertiesService.getScriptProperties();
  }

  /**
   * Set services dependent on each script.
   *
   * @param {Object} services Object containing services.
   * @param {GoogleAppsScript.Lock.Lock} services.lock Lock service instance.
   * @param {GoogleAppsScript.Properties.Properties} services.properties Properties service instance.
   * @return {A2AApp}
   */
  setServices(services) {
    const { lock, properties } = services;
    if (lock && lock.toString() === "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() === "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /**
   * Sets the conversation history for the agent.
   * This allows the agent to maintain context across multiple interactions in a chat environment.
   *
   * @param {Array<Object>} history - An array of history objects containing 'role' and 'parts'.
   * @returns {A2AApp} This agent instance for chaining.
   */
  setHistory(history) {
    if (!Array.isArray(history)) {
      throw new Error(
        "CRITICAL: History must be an array of objects compatible with GeminiWithFiles.",
      );
    }
    this.history = history;
    return this;
  }

  /**
   * Retrieves the current conversation history.
   *
   * @returns {Array<Object>} The current history array.
   */
  getHistory() {
    return this.history || [];
  }

  /**
   * Method for the A2A server side logic.
   *
   * @param {Object} object Parameters object.
   * @param {Object} object.eventObject Event object from doPost/doGet.
   * @param {String} object.apiKey API key for Gemini.
   * @param {Function} object.agentCard Getter function for agent card object.
   * @param {Function} object.functions Getter function for functions object.
   * @return {GoogleAppsScript.Content.TextOutput}
   */
  server(object = {}) {
    this.contextType = "server";
    console.log("--- Server side initialized");
    this.errorProcess_(object);
    let id = "No ID";
    const lock = this.lock;

    // [Phase 1: Concurrency Control] Server-side locking to prevent race conditions
    if (!lock.tryLock(350000)) {
      const msg =
        "[Phase 1: Concurrency Control] Timeout. Lock could not be acquired.";
      console.error(msg);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${msg}`,
        id,
        "[Phase 1: Concurrency Control]",
      );
    }
    this.addLog_(
      new Date(),
      "[Phase 1: Concurrency Control]",
      id,
      "server internal",
      "Lock acquired successfully.",
    );

    try {
      const { eventObject, agentCardUrls = [], agentCards = [] } = object;
      const obj = eventObject.postData ? this.parseObj_(eventObject) : {};
      id = obj.id || "No ID";

      // [Phase 2: Agent Discovery] Handle Agent Card retrieval logic internally if URLs provided
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      const res = this.createResponse_({ ...object, obj, id });
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${err.stack}`,
        id,
        "Server Main Process",
      );
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Method for the A2A client side logic.
   *
   * @param {Object} object Parameters object.
   * @return {Object} Result object including result, history, and agentCards.
   */
  client(object = {}) {
    this.contextType = "client";
    console.log("--- Client side initialized");
    const lock = this.lock;

    // [Phase 1: Concurrency Control] Client-side locking
    if (!lock.tryLock(350000)) {
      const msg =
        "[Phase 1: Concurrency Control] Timeout. Lock could not be acquired.";
      console.error(msg);
      const errObj = {
        error: { message: `Internal server error. Error message: ${msg}` },
      };
      this.addLog_(
        new Date(),
        "[Phase 1: Concurrency Control]",
        null,
        "client internal",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    }
    this.addLog_(
      new Date(),
      "[Phase 1: Concurrency Control]",
      null,
      "client internal",
      "Lock acquired successfully.",
    );

    try {
      // [Phase 2: Agent Discovery] Fetch Agent Cards
      const {
        agentCardUrls = [],
        agentCards = [],
        history = this.history || [],
        directRouting = false,
      } = object;
      object.history = history;
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      let res;
      // [Optimization v2.7.0]: If directRouting is flagged (via LlmAgent), cleanly bypass ALL LLM Mock Orchestration
      // and directly dispatch the JSON-RPC to the network layer.
      if (
        directRouting &&
        object.agentCards &&
        object.agentCards.length === 1
      ) {
        res = this.dispatchDirectRPC_(object);
      } else {
        res = this.processAgents_(object);
      }

      // Safe History Updating
      if (res && res.history) {
        this.history = res.history;
      }
      this.log_();
      return res;
    } catch (err) {
      console.error(err.stack);
      const errObj = {
        error: {
          message: `Internal server error. Error message: ${err.stack}`,
        },
      };
      this.addLog_(
        new Date(),
        "Client Main Process",
        null,
        "client internal",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    } finally {
      lock.releaseLock();
    }
  }

  /**
   * Validate required parameters.
   * @private
   */
  errorProcess_(object) {
    if (!object.eventObject) {
      throw new Error("Please set event object from doPost and doGet.");
    }
    if (!object.apiKey) {
      throw new Error("Please set your API key for using Gemini API.");
    }
  }

  /**
   * Helper: Add log entries to the queue seamlessly.
   * @private
   */
  addLog_(date, phaseOrMethod, id, direction, message) {
    if (this.log) {
      this.values.push([
        date,
        phaseOrMethod || "",
        id || "",
        direction || "",
        message,
      ]);
    }
  }

  /**
   * Helper: Create formatted Server Error Response.
   * @private
   */
  createErrorResponse_(message, id, phaseOrMethod) {
    const errObj = {
      jsonrpc: this.jsonrpc,
      error: { code: this.ErrorCode["Internal server error"], message },
      id,
    };
    this.addLog_(
      new Date(),
      phaseOrMethod || "Error Response",
      id,
      "server --> client",
      JSON.stringify(errObj),
    );
    this.log_();
    return this.createContent_(errObj);
  }

  /**
   * Create response for the server operations.
   * @private
   */
  createResponse_(object) {
    const {
      eventObject,
      apiKey,
      agentCard,
      functions,
      agentCards = [],
      obj,
      id,
    } = object;
    const { pathInfo, parameter } = eventObject;

    // [Phase 2: Agent Discovery] Handle Discovery (Agent Card request from client)
    if (
      pathInfo === ".well-known/agent.json" ||
      pathInfo === ".well-known/agent-card.json"
    ) {
      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "client --> server",
        "Received request for Agent Card.",
      );
      if (typeof agentCard !== "function") {
        throw new Error("Agent card was not found or is not a function.");
      }
      const agentCardObj = agentCard();

      agentCards.forEach(
        ({
          description = "",
          skills = [],
          defaultInputModes = [],
          defaultOutputModes = [],
        }) => {
          if (description) agentCardObj.description += `\n${description}`;
          agentCardObj.skills.push(...skills);
          agentCardObj.defaultInputModes.push(...defaultInputModes);
          agentCardObj.defaultOutputModes.push(...defaultOutputModes);
        },
      );

      // De-duplicate using stringified comparisons for deep objects and Sets for primitives
      const uniqueSkills = new Map(
        agentCardObj.skills.map((s) => [JSON.stringify(s), s]),
      );
      agentCardObj.skills = Array.from(uniqueSkills.values());
      agentCardObj.defaultInputModes = [
        ...new Set(agentCardObj.defaultInputModes),
      ];
      agentCardObj.defaultOutputModes = [
        ...new Set(agentCardObj.defaultOutputModes),
      ];

      this.addLog_(
        new Date(),
        "[Phase 2: Agent Discovery]",
        id,
        "server --> client",
        JSON.stringify(agentCardObj),
      );
      return this.createContent_(agentCardObj);
    }

    if (!obj.method) return null;
    const method = obj.method.toLowerCase();

    // Log incoming payload as client --> server
    this.addLog_(
      new Date(),
      `RPC Method: ${method}`,
      id,
      "client --> server",
      JSON.stringify(obj),
    );

    // 2. Authentication Check
    if (this.accessKey && parameter.accessKey !== this.accessKey) {
      const errMsg = "Invalid accessKey.";
      console.warn(`--- Server Auth Error: ${errMsg}`);
      this.addLog_(new Date(), "Authentication", id, "server internal", errMsg);
      const errObj = {
        jsonrpc: this.jsonrpc,
        error: {
          code: this.ErrorCode["Authorization failed"],
          message: `Authorization failed. ${errMsg}`,
        },
        id,
      };
      this.addLog_(
        new Date(),
        "Authentication",
        id,
        "server --> client",
        JSON.stringify(errObj),
      );
      return this.createContent_(errObj);
    }

    // [Phases 3-7 triggered via processAgents_] Handle 'message/send' and 'tasks/send' seamlessly
    if ((method === "message/send" || method === "tasks/send") && functions) {
      if (typeof functions !== "function") {
        return this.createErrorResponse_(
          "Internal server error. Invalid functions.",
          id,
          method,
        );
      }

      try {
        const { params } = obj;
        const { message, history: clientHistory = [] } = params;
        const prompt = message?.parts?.[0]?.text || "";

        // Trigger the internal orchestration logic on the server side
        const orchestrationRes = this.processAgents_({
          apiKey,
          prompt,
          history: clientHistory,
          functions: functions(),
          fileAsBlob: true,
          agentCards,
        });

        // Guard against internal orchestration failures (e.g., LLM planning crash)
        if (orchestrationRes.error) {
          const errMsg =
            orchestrationRes.error.message ||
            "Internal server orchestration error.";
          console.error(`--- Server Process Error: ${errMsg}`);
          return this.createErrorResponse_(errMsg, id, method);
        }

        const { result, history } = orchestrationRes;
        const artifacts = [];
        const messageParts = [];

        // Distribute generated textual components and file references
        for (let i = 0; i < result.length; i++) {
          const e =
            typeof result[i] === "string"
              ? { type: "text", kind: "text", text: result[i] }
              : result[i];
          const type = e.type;

          if (type === "text") {
            const textPart = {
              type: "text",
              kind: "text",
              text: e[type] || e.text,
            };
            messageParts.push(textPart);
            artifacts.push({ name: "Answer", index: i, parts: [textPart] });
          } else {
            if (type !== "file" && type !== "data") {
              messageParts.push(e);
            } else {
              messageParts.push({
                type: "text",
                kind: "text",
                text: `The data "${e[type]?.name || "file"}" was downloaded.`,
              });
            }
            artifacts.push({ name: "Answer", index: i, parts: [e] });
          }
        }

        const resObj =
          method === "message/send"
            ? {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "message",
                  messageId: params.messageId,
                  parts: messageParts,
                  role: "agent",
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              }
            : {
                jsonrpc: this.jsonrpc,
                result: {
                  kind: "task",
                  id: params.id,
                  sessionId: params.sessionId,
                  status: {
                    state: this.TaskState.completed,
                    message: { role: "agent", parts: messageParts },
                    timestamp: new Date().toISOString(),
                  },
                  artifacts,
                  history: history, // Provide updated CLEAN history state back to client
                },
                id,
              };

        // [Phase 7: Final Synthesis] Returning the final response structure to the calling client.
        this.addLog_(
          new Date(),
          "[Phase 7: Final Synthesis]",
          id,
          "server --> client",
          JSON.stringify(resObj),
        );
        return this.createContent_(resObj);
      } catch (err) {
        console.error(`--- Server Process Error: ${err.stack}`);
        return this.createErrorResponse_(
          `Internal server error. Error message: ${err.stack}`,
          id,
          method,
        );
      }
    }

    return null;
  }

  /**
   * Parse postData contents gracefully.
   * @private
   */
  parseObj_(e) {
    if (e?.postData?.contents) {
      try {
        return JSON.parse(e.postData.contents);
      } catch (err) {
        console.warn("--- Failed to parse postData contents.", err);
      }
    }
    return {};
  }

  /**
   * Create JSON TextOutput context.
   * @private
   */
  createContent_(data) {
    const d = typeof data === "object" ? JSON.stringify(data) : data;
    return ContentService.createTextOutput(d).setMimeType(
      ContentService.MimeType.JSON,
    );
  }

  /**
   * Persist queue logs to Google Spreadsheet en-masse.
   * @private
   */
  log_() {
    if (!this.log || !this.sheet || this.values.length === 0) return;
    try {
      const rows = this.values.map((r) =>
        r.map((c) => (typeof c === "string" ? c.substring(0, 40000) : c)),
      );
      this.sheet
        .getRange(this.sheet.getLastRow() + 1, 1, rows.length, rows[0].length)
        .setValues(rows);
      this.values = [];
    } catch (err) {
      console.error("--- Failed to write to log sheet.", err);
    }
  }

  /**
   * [Direct Routing: Fast-Track JSON-RPC Dispatcher]
   * Radically optimized pipeline for execution when an Orchestrator explicitly assigns a specific target card.
   * Discards the massive overhead of Phase 3 to 7 LLM proxy emulation logic.
   * @private
   */
  dispatchDirectRPC_(object) {
    const { apiKey, prompt, agentCards, history = [] } = object;
    const targetAgent = agentCards[0];

    const phaseTag = "[Direct Routing: Fast-Track JSON-RPC]";
    console.log(
      `${phaseTag} Bypassing internal LLM orchestration to dispatch natively.`,
    );
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client internal",
      `Target Agent Resolved: ${targetAgent.name || "Unknown Agent"}`,
    );

    const id1 = Utilities.newBlob(new Date().getTime().toString())
      .getBytes()
      .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
      .join("");
    const id2 = Utilities.getUuid();
    const id3 = Utilities.getUuid();

    const resObj = {
      jsonrpc: this.jsonrpc,
      id: id1,
      method: "tasks/send",
      params: {
        id: id2,
        sessionId: id3,
        message: {
          role: "user",
          parts: [{ type: "text", text: prompt }],
        },
        acceptedOutputModes: ["text", "text/plain"],
        history: history,
      },
    };

    const combinedHeaders = {
      ...this.headers,
      ...(targetAgent.customHeaders || {}),
    };

    const req = {
      url: targetAgent.url,
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(resObj),
      headers: combinedHeaders,
      muteHttpExceptions: true,
    };

    console.log(`${phaseTag} Dispatching request to: ${req.url}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "client --> server",
      `JSON-RPC Payload dispatched.`,
    );

    const re = UrlFetchApp.fetch(req.url, req);
    const code = re.getResponseCode();
    const body = re.getContentText();

    console.log(`${phaseTag} Remote agent responded with HTTP Code: ${code}`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      "server --> client",
      `Code: ${code}, Body: ${body.substring(0, 1500)}`,
    );

    let results = [];
    if (code === 200) {
      try {
        const oo = JSON.parse(body);
        if (oo.result && oo.result.status?.state === "completed") {
          const sArtifacts = (oo.result.artifacts || []).flatMap(
            ({ parts }) => parts,
          );
          const messageParts = oo.result.status.message?.parts || [];

          const uniqueTexts = new Set();
          const m = [...messageParts, ...sArtifacts].filter((part) => {
            if (part.type === "text") {
              const txt = part.text || "";
              if (uniqueTexts.has(txt)) return false;
              uniqueTexts.add(txt);
            }
            return true;
          });

          results = m.map((part) => part.text || part);
        } else if (oo.error) {
          results.push(
            `Error: Remote agent returned error: ${JSON.stringify(oo.error)}`,
          );
        } else {
          results.push(`Error: Invalid response structure. Body: ${body}`);
        }
      } catch (e) {
        results.push(`Error: Failed to parse JSON response. Body: ${body}`);
      }
    } else {
      results.push(`Error: Remote agent returned HTTP ${code}. Body: ${body}`);
    }

    const historyAnswerText = results
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");
    const cleanHistory = [...history];
    if (prompt) cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    if (historyAnswerText)
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });

    console.log(`${phaseTag} Sequence completed successfully.`);
    return { result: results, history: cleanHistory, agentCards };
  }

  /**
   * [Phase 3: Tool Proxying] Prepare client-side functions inclusive of remote agents.
   * Incorporates detailed logging wrappers for introspection and injects custom headers for authenticated routing.
   * @private
   */
  getClientFunctions_(agentCards, addedFunctions, history = []) {
    const phaseTag = "[Phase 3: Tool Proxying]";
    console.log(`${phaseTag} Initiated capabilities mapping.`);
    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      "Mapping capabilities into Function Calling schemas.",
    );

    let funcs = {
      params_: {
        without_agent: {
          description:
            "Use this, if the agent and other functions cannot resolve the tasks.",
          parameters: {
            type: "object",
            properties: {
              task: { type: "string", description: "Details of task." },
              response: {
                type: "string",
                description: "Response to the task.",
              },
            },
            required: ["task", "response"],
          },
        },
      },
      without_agent: ({ task, response }) => {
        const msgCall = `--- without_agent invoked. Prompt: ${task}`;
        console.log(msgCall);
        this.addLog_(
          new Date(),
          "[Phase 5: Sequential Execution]",
          null,
          `${this.contextType} internal`,
          msgCall,
        );
        return { task, result: response };
      },
    };

    // Integrate Discovered AI agents via dynamic schema proxying
    if (agentCards.length > 0) {
      agentCards.forEach(
        ({ name, description, url, provider, skills, customHeaders = {} }) => {
          // Add 'customType_' prefix to intentionally bypass GeminiWithFiles automatic loop execution.
          const safeName = "customType_" + name.replace(/ /g, "_");
          const skillStr = skills
            .map((o) => {
              const name = o.name || "no name";
              const description = o.description || "no description";
              const examples =
                o.examples && o.examples.length > 0
                  ? o.examples.join(", ")
                  : "no examples";

              return `id: ${o.id}, name: ${name}, description: ${description}, examples: ${examples}`;
            })
            .join(" | ");

          funcs.params_[safeName] = {
            description: [
              `Agent name: ${safeName}`,
              `Description: ${description}`,
              `URL: ${url}`,
              `Skills: ${skillStr}`,
              provider
                ? `Provider: ${provider.organization}, ${provider.url}`
                : "",
            ]
              .filter(Boolean)
              .join("\n"),
            parameters: {
              type: "object",
              properties: {
                agent_name: {
                  type: "string",
                  description: "Agent name you selected.",
                },
                agent_url: { type: "string", description: "URL of the agent." },
                task: {
                  type: "string",
                  description:
                    "Details of task. Give the suitable task to this agent.",
                },
              },
              required: ["agent_name", "agent_url", "task"],
            },
          };

          // Define proxy facade to safely remote trigger specific capabilities
          funcs[safeName] = (args) => {
            const { agent_name, agent_url, task } = args;
            const msgCall = `Agent Call proxy invoked: "${agent_name}" | Assigned Task: "${task}" | URL: ${agent_url}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              `${this.contextType} internal`,
              msgCall,
            );

            const id1 = Utilities.newBlob(new Date().getTime().toString())
              .getBytes()
              .map((byte) => ("0" + (byte & 0xff).toString(16)).slice(-2))
              .join("");
            const id2 = Utilities.getUuid();
            const id3 = Utilities.getUuid();

            const resObj = {
              jsonrpc: this.jsonrpc,
              id: id1,
              method: "tasks/send",
              params: {
                id: id2,
                sessionId: id3,
                message: {
                  role: "user",
                  parts: [{ type: "text", text: task }],
                },
                acceptedOutputModes: ["text", "text/plain"],
                history: history, // Injects context state natively into remote protocol requests
              },
            };

            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "client --> server",
              `JSON-RPC Payload created: ${JSON.stringify(resObj)}`,
            );

            // Apply specific custom headers dynamically extracted from the normalization sequence
            const combinedHeaders = { ...this.headers, ...customHeaders };

            // Wrap response in 'items' pattern to enforce the immediate bypass strategy
            // and forcefully specify 'method' and 'contentType' to avoid invalid generic GET requests.
            return {
              items: {
                functionResponse: {
                  request: {
                    url: agent_url,
                    method: "post",
                    contentType: "application/json",
                    payload: JSON.stringify(resObj),
                    headers: combinedHeaders,
                    muteHttpExceptions: true,
                  },
                  resObj,
                  name: safeName,
                  argsObj: args,
                },
              },
            };
          };
        },
      );
    }

    // Merge User's custom defined implementations with interceptors for granular logging
    if (addedFunctions?.params_) {
      funcs.params_ = { ...funcs.params_, ...addedFunctions.params_ };
      Object.keys(addedFunctions).forEach((k) => {
        if (k !== "params_") {
          const originalFunc = addedFunctions[k];
          funcs[k] = (args) => {
            const msgCall = `Local Function Executed: "${k}" | Args: ${JSON.stringify(args)}`;
            console.log(`[Phase 5: Sequential Execution] ${msgCall}`);
            this.addLog_(
              new Date(),
              "[Phase 5: Sequential Execution]",
              null,
              "server internal",
              msgCall,
            );
            try {
              const res = originalFunc(args);
              const strRes = JSON.stringify(res) || "";
              const msgRet = `Function Returned: "${k}" | Data: ${strRes.substring(0, 1000)}`;
              console.log(`[Phase 5: Sequential Execution] ${msgRet}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgRet,
              );
              return res;
            } catch (err) {
              const msgErr = `Function Error: "${k}" | Stack: ${err.stack}`;
              console.error(`[Phase 5: Sequential Execution] ${msgErr}`);
              this.addLog_(
                new Date(),
                "[Phase 5: Sequential Execution]",
                null,
                "server internal",
                msgErr,
              );
              throw err;
            }
          };
        }
      });
    }

    return funcs;
  }

  /**
   * Fetch multiple URLs in chunks to avoid AppScript service limits.
   * @private
   */
  fetchAllWithLimitations_(requests, limit = 20) {
    const res = [];
    for (let i = 0; i < requests.length; i += limit) {
      res.push(...UrlFetchApp.fetchAll(requests.slice(i, i + limit)));
    }
    return res;
  }

  /**
   * [Phase 2: Agent Discovery] Retrieve and parse agent cards optimally from given URLs.
   * Handles string URLs as well as structured objects encapsulating custom headers.
   * @param {Array<String|Object>} agentCardUrls Array of strings or objects referring to remote card sources.
   * @return {Array<Object>} Array of sanitized agent card objects.
   */
  getAgentCards(agentCardUrls) {
    const phaseTag = "[Phase 2: Agent Discovery]";
    console.log(`${phaseTag} Initiating agent card retrieval.`);

    if (!agentCardUrls || agentCardUrls.length === 0) {
      console.warn(`${phaseTag} No agent cards URLs provided.`);
      return [];
    }

    // Normalize inputs separating clean string paths and embedded object configurations
    const normalizedUrls = agentCardUrls
      .map((item) => {
        if (typeof item === "string" && item.trim() !== "") {
          return { url: item.trim(), headers: {}, original: item };
        } else if (typeof item === "object" && item !== null) {
          const key = Object.keys(item)[0];
          const val = item[key];
          if (val && val.httpUrl) {
            return {
              url: val.httpUrl.trim(),
              headers: val.headers || {},
              original: item,
            };
          }
        }
        return null;
      })
      .filter(Boolean);

    if (normalizedUrls.length === 0) {
      console.warn(`${phaseTag} No valid agent cards configurations parsed.`);
      return [];
    }

    this.addLog_(
      new Date(),
      phaseTag,
      null,
      `${this.contextType} internal`,
      `Target URLs Processed: ${normalizedUrls.length}`,
    );

    const requests = normalizedUrls.map((norm) => {
      const { url, queryParameters } = this.parseQueryParameters_(norm.url);
      const path = url.split("/").pop();
      const targetUrl = ["exec", "dev"].includes(path)
        ? `${url.trim()}/.well-known/agent-card.json`
        : url.trim();

      // Merge native authentication scopes with the provided dynamic context headers
      const combinedHeaders = { ...this.headers, ...norm.headers };

      this.addLog_(
        new Date(),
        phaseTag,
        null,
        "client --> server",
        `Requesting well-known agent configuration from: ${targetUrl}`,
      );

      return {
        url: this.addQueryParameters_(targetUrl, queryParameters || {}),
        headers: combinedHeaders,
        muteHttpExceptions: true,
      };
    });

    const ress = this.fetchAllWithLimitations_(requests);
    const agentCards = ress.reduce((acc, res, i) => {
      if (res.getResponseCode() === 200) {
        try {
          const o = JSON.parse(res.getContentText());
          o.url = o.url || normalizedUrls[i].url;
          o.customHeaders = normalizedUrls[i].headers; // Inject mapping context downstream

          if (o.name) {
            o.name = o.name.replace(/ /g, "_");
          }
          acc.push(o);
          this.addLog_(
            new Date(),
            phaseTag,
            null,
            "server --> client",
            `Successfully retrieved card for agent: ${o.name}`,
          );
        } catch (e) {
          console.warn(
            `${phaseTag} Failed to parse agent card from "${normalizedUrls[i].url}".`,
          );
        }
      } else {
        console.warn(
          `${phaseTag} Didn't get agent card from "${normalizedUrls[i].url}". HTTP Status: ${res.getResponseCode()}`,
        );
      }
      return acc;
    }, []);

    if (agentCards.length === 0) {
      console.warn(`${phaseTag} No valid agent cards found.`);
    }

    console.log(`${phaseTag} Agent card retrieval complete.`);
    return agentCards;
  }

  /**
   * Core execution orchestration engine for handling prompt assignments dynamically.
   * Runs sequentially through Phase 4, 5, 6, 7.
   * @private
   */
  processAgents_(object) {
    const {
      apiKey,
      agentCards,
      prompt = "",
      history = [],
      fileAsBlob = false,
      functions,
    } = object;

    // [Phase 3: Tool Proxying]
    const addedFunctions = functions ? { ...functions } : null;
    const createdFunctions = this.getClientFunctions_(
      agentCards,
      addedFunctions,
      history,
    );

    // [Phase 4: Planning]
    const phase4Tag = "[Phase 4: Planning]";
    console.log(`${phase4Tag} Analyzing prompt and selecting optimal routing.`);

    let agents = agentCards.map(({ name, description, url, skills }) => {
      const skillStr = skills.map(
        (e) =>
          `Skill name: ${e.name || "no name"}, Description of skill: ${e.description || "no description"}, Examples: ${e.examples && e.examples.length ? e.examples.join(",") : "no examples"}`,
      );
      return `- Name: "${name}", Description: "${description}", URL: "${url}", skills: "${skillStr}"`;
    });
    if (agents.length === 0) agents = ["No agents."];

    let functionCallings = Object.entries(createdFunctions.params_).map(
      ([k, v]) => `- Name: "${k}", Details: ${JSON.stringify(v)}`,
    );
    if (functionCallings.length === 0) functionCallings = ["No functions."];

    const msgAnalyze = `Available Remote Agents: ${agentCards.length} | Available Local Functions/Proxies: ${Object.keys(createdFunctions.params_).length}`;
    console.log(`${phase4Tag} ${msgAnalyze}`);
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgAnalyze,
    );

    // Construct the guiding System Instruction layout dynamically
    const systemInstructionText = [
      "You are an expert delegator capable of assigning user requests to appropriate remote agents. You create the suitable order for processing agents and functions.",
      "<Agents>",
      "The following agents are the available agent list.",
      ...agents,
      "</Agents>",
      "<Functions>",
      "The following functions are the available function list. The JSON schema of the value of 'Details' is the same with the schema for the function calling. From 'Details', understand the functions.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Understand the agents and the tasks that the agents can do.",
      "- Understand the functions and the tasks that the functions can do.",
      "- Understand requests of the user's prompt.",
      "- For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions for accurately resolving requests of the user's prompt in the suitable order. Always include the remote agent's name and the function name when responding to the user.",
      "- If multiple processes can be run with a single agent or a function, create a suitable prompt including those processes in it.",
      "- If the suitable agent and functions cannot be found, directly answer without using them.",
      "</Mission>",
      "<Important>",
      "- Do not fabricate responses.",
      "- If you are unsure, ask the user for more details.",
      "- Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      "- When the requests include both the agent can resolve and the agent cannot resolve, suggest the order by including the agents, functions, and 'without_agent'.",
      "- Do not fabricate or invent any agent names or function names. Use ONLY the ones explicitly provided.",
      `- Don't include some code in the response value like "tool_code".`,
      `- Don't suggest some code in the response value like "tool_code".`,
      `- If you are required to know the current date time, it's "${Utilities.formatDate(this.date, this.timezone, "yyyy-MM-dd HH:mm:ss")}". And, timezone is ${this.timezone}.`,
      "</Important>",
    ].join("\n");

    const responseSchema = {
      title: "Order of agents and functions for resolving the user's prompt.",
      description:
        "Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { description: "Agent name or function name.", type: "string" },
          task: {
            description:
              "For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions to accurately resolve requests of the user's prompt in the suitable order. Here, don't include the agent URL.",
            type: "string",
          },
        },
      },
    };

    // Initial Orchestration invocation
    const g = new GeminiWithFiles({
      apiKey,
      systemInstruction: {
        parts: [{ text: systemInstructionText }],
        role: "model",
      },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
    });
    g.history = [...history, ...(g.history || [])];

    const textPrompt = `User's prompt is as follows.\n<UserPrompt>${prompt}</UserPrompt>`;
    const orderArTemp = g.generateContent({ q: textPrompt });
    const orderAr = Array.isArray(orderArTemp) ? orderArTemp : [];

    const msgOrder = `Determined Execution Order: ${JSON.stringify(orderAr)}`;
    console.log(`${phase4Tag} ${msgOrder}`);
    forDebug && toLog_("orderAr", JSON.stringify(orderAr));
    this.addLog_(
      new Date(),
      phase4Tag,
      null,
      `${this.contextType} internal`,
      msgOrder,
    );

    if (!Array.isArray(orderAr) || orderAr.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode["Internal server error"],
          message: "Internal server error. Execution Order Generation Failed.",
        },
        jsonrpc: this.jsonrpc,
        id: null,
      };
      console.error(`${phase4Tag} Execution Order Generation Failed.`);
      this.addLog_(
        new Date(),
        phase4Tag,
        null,
        `${this.contextType} internal`,
        JSON.stringify(errObj),
      );
      return errObj;
    }

    // [Phase 5: Sequential Execution]
    const phase5Tag = "[Phase 5: Sequential Execution]";
    console.log(
      `${phase5Tag} Initiating sequential execution based on planning phase.`,
    );
    let tempHistory = [...g.history];
    const results = [];

    // Evaluate the sequential path sequentially
    for (const { name, task } of orderAr) {
      const msgExec = `Delegating to Tool/Agent: "${name}" | Task Details: "${task}"`;
      console.log(`${phase5Tag} ${msgExec}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgExec,
      );

      const funcCall = {
        params_: { [name]: createdFunctions.params_[name] },
        [name]: createdFunctions[name],
      };

      const gg = new GeminiWithFiles({
        apiKey,
        model: this.model,
        functions: funcCall,
        history: tempHistory,
        toolConfig: {
          functionCallingConfig: { mode: "any", allowedFunctionNames: [name] },
        },
      });

      const q = [
        `Your task is as follows.`,
        `<Task>${task}</Task>`,
        `<Important>`,
        `- If you do not have enough information to resolve "Task", ask the user for more details without generating content forcefully.`,
        `</Important>`,
      ].join("\n");

      const res = gg.generateContent({ q });

      const msgResType = `Result received from Gemini node for "${name}" | Type: [${typeof res}] | Content preview: ${typeof res === "string" ? res : JSON.stringify(res).substring(0, 500)}`;
      console.log(`${phase5Tag} ${msgResType}`);
      this.addLog_(
        new Date(),
        phase5Tag,
        null,
        `${this.contextType} internal`,
        msgResType,
      );
      forDebug && toLog_("In task loop", JSON.stringify(res));

      // Check if bypassed via customType_ return mechanism
      const funcRes =
        res.functionResponse ||
        (res.items && res.items.functionResponse
          ? res.items.functionResponse
          : undefined);

      // Handle the resulting operation appropriately whether standard Function or A2A
      if (typeof res === "string") {
        results.push({ type: "text", text: res });
      } else if (res.text) {
        results.push({ type: "text", text: res.text });
      } else if (Array.isArray(res)) {
        // Handle array responses naturally
        const texts = res.map((r) =>
          typeof r === "string" ? r : r.text || JSON.stringify(r),
        );
        results.push({ type: "text", text: texts.join("\n") });
      } else if (funcRes?.request) {
        const req = funcRes.request;
        const msgReq = `Dispatching JSON-RPC request to remote agent: ${req.url}`;
        console.log(`${phase5Tag} ${msgReq}`);
        this.addLog_(new Date(), phase5Tag, null, "client --> server", msgReq);

        const re = UrlFetchApp.fetch(req.url, req);
        const code = re.getResponseCode();
        const body = re.getContentText();

        const msgRes = `Remote agent responded with HTTP Code: ${code}`;
        console.log(`${phase5Tag} ${msgRes}`);
        this.addLog_(
          new Date(),
          phase5Tag,
          null,
          "server --> client",
          `Code: ${code}, Body: ${body.substring(0, 1500)}`,
        );

        if (code === 200) {
          const oo = JSON.parse(body);
          if (oo.result) {
            const {
              id: id1,
              params: { id: id2, sessionId: id3 },
            } = funcRes.resObj;

            if (
              oo.result.status?.state === "completed" &&
              oo.id === id1 &&
              oo.result.id === id2 &&
              oo.result.sessionId === id3
            ) {
              const sArtifacts = (oo.result.artifacts || []).flatMap(
                ({ parts }) => parts,
              );
              const messageParts = oo.result.status.message?.parts || [];

              // Deduplicate redundant text blocks natively spawned from separate artifact schemas
              const uniqueTexts = new Set();
              const m = [...messageParts, ...sArtifacts].filter((part) => {
                if (part.type === "text") {
                  const txt = part.text || "";
                  if (uniqueTexts.has(txt)) return false;
                  uniqueTexts.add(txt);
                }
                return true;
              });

              results.push(...m);

              // Emulate structural knowledge block representation for tracking context effectively
              let bkHistory = m.filter((mm) => mm.type === "text");
              if (bkHistory.length === 0 && m.length > 0) {
                const sss = m
                  .map(
                    (mm) =>
                      `Name: ${mm[mm.type]?.name}, MimeType: ${mm[mm.type]?.mimeType}`,
                  )
                  .join("\n");
                bkHistory = [
                  { type: "text", text: `Data is as follows.\n${sss}` },
                ];
              }

              // Manually patch the history array as the loop bypass prevents GeminiWithFiles from appending the call details automatically.
              if (funcRes.name && funcRes.argsObj) {
                gg.history.push({
                  role: "model",
                  parts: [
                    {
                      functionCall: {
                        name: funcRes.name,
                        args: funcRes.argsObj,
                      },
                    },
                  ],
                });
                gg.history.push({
                  role: "function",
                  parts: [
                    {
                      functionResponse: {
                        name: funcRes.name,
                        response: { name: funcRes.name, content: bkHistory },
                      },
                    },
                  ],
                });
              } else {
                const lastHistory = gg.history[gg.history.length - 1];
                if (lastHistory?.parts?.[0]?.functionResponse?.response) {
                  lastHistory.parts[0].functionResponse.response.content =
                    bkHistory;
                }
              }
            } else {
              const errMsg = `Error: Remote agent ${name} did not complete successfully. Task: ${task}`;
              console.error(`${phase5Tag} ${errMsg}`);
              results.push({ type: "text", text: errMsg });
            }
          } else if (oo.error) {
            const errMsg = `Error: Remote agent ${name} returned error: ${JSON.stringify(oo.error)}`;
            console.error(`${phase5Tag} ${errMsg}`);
            results.push({ type: "text", text: errMsg });
          }
        } else {
          const errMsg = `Error: Remote agent ${name} returned HTTP ${code}. Task: ${task}`;
          console.error(`${phase5Tag} ${errMsg}`);
          results.push({ type: "text", text: errMsg });
        }
      } else if (funcRes?.result) {
        let text = funcRes.result;
        if (funcRes.result?.content?.[0]?.text) {
          text = funcRes.result.content[0].text;
        }
        results.push({ type: "text", text });
      } else if (funcRes?.a2a?.result) {
        results.push({ type: "text", text: funcRes.a2a.result });
      } else {
        // Enforce standard object output architecture so subsequent file evaluation map skips over this payload properly.
        const errMsg = `Error: Name: ${name}, Task: ${task}, Unhandled Result Type: ${JSON.stringify(res)}`;
        console.error(`${phase5Tag} ${errMsg}`);
        results.push({
          type: "text",
          text: errMsg,
        });
      }
      tempHistory = gg.history;
    }

    // [Phase 6: Data Materialization]
    const phase6Tag = "[Phase 6: Data Materialization]";
    console.log(
      `${phase6Tag} Isolating textual structural outcomes and physical blobs.`,
    );
    let finalResults = results.map((o) => {
      const type = o.type;
      if (type === "text") {
        this.addLog_(
          new Date(),
          phase6Tag,
          null,
          `${this.contextType} internal`,
          "Result materialized as pure text.",
        );
        return o[type] || o.text;
      }

      this.addLog_(
        new Date(),
        phase6Tag,
        null,
        `${this.contextType} internal`,
        "Result materialized as binary file content.",
      );
      const data = o[type];
      let fileBlob;
      if (data?.bytes) {
        fileBlob = Utilities.newBlob(
          Utilities.base64Decode(data.bytes),
          data.mimeType,
          data.name,
        );
      }

      if (fileBlob) {
        if (fileAsBlob) {
          return fileBlob;
        } else {
          let fileUrl = "";
          if (data.bytes) {
            const file = DriveApp.createFile(fileBlob);
            fileUrl = file.getUrl();
          }
          return `The file was created as an answer. The file URL is "${fileUrl}".`;
        }
      }
      return `The type of file was returned. But, the file content was not included in the response.`;
    });

    forDebug && toLog_("finalResults1", JSON.stringify(finalResults));

    // [Phase 7: Final Synthesis]
    const phase7Tag = "[Phase 7: Final Synthesis]";
    console.log(`${phase7Tag} Synthesizing final aggregate outputs.`);
    const strResults = finalResults.filter((e) => typeof e === "string");
    if (strResults.length > 0) {
      if (strResults.length === 1 && finalResults.length === 1) {
        // Optimization: Skip unnecessary summarization if only one string outcome exists
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Bypassing extra synthesis step due to singular text outcome.",
        );
      } else {
        this.addLog_(
          new Date(),
          phase7Tag,
          null,
          `${this.contextType} internal`,
          "Aggregating multiple textual blocks via LLM abstraction.",
        );
        const gg = new GeminiWithFiles({
          apiKey,
          model: this.model,
          history: tempHistory,
        });
        const res3 = gg.generateContent({
          parts: [
            { text: `Summarize answers by considering the question.` },
            { text: `<Question>${prompt}</Question>` },
            { text: `<Answers>${strResults.join("\n")}</Answers>` },
          ],
        });
        finalResults = [
          res3,
          ...finalResults.filter((e) => typeof e !== "string"),
        ];
      }
    } else {
      this.addLog_(
        new Date(),
        phase7Tag,
        null,
        `${this.contextType} internal`,
        "No string components required synthesis.",
      );
    }

    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      `Finalized payload synthesis completed: ${JSON.stringify(finalResults).substring(0, 1000)}`,
    );

    console.log(`${phase7Tag} Completed.`);
    forDebug && toLog_("finalResults2", JSON.stringify(finalResults));

    // [Refactoring: Clean History Construction]
    // Eliminate massive internal intermediate LLM reasoning steps (functionCall, thoughtSignature, etc.) from the propagated history.
    this.addLog_(
      new Date(),
      phase7Tag,
      null,
      `${this.contextType} internal`,
      "Constructing clean history to prevent token bloat.",
    );

    const historyAnswerText = finalResults
      .map((e) => (typeof e === "string" ? e : "[Binary Data]"))
      .join("\n");

    const cleanHistory = [...history];
    if (prompt) {
      cleanHistory.push({ role: "user", parts: [{ text: prompt }] });
    }
    if (historyAnswerText) {
      cleanHistory.push({
        role: "model",
        parts: [{ text: historyAnswerText }],
      });
    }

    return { result: finalResults, history: cleanHistory, agentCards };
  }

  /**
   * Helper: Parse URL query parameters recursively dynamically.
   * @private
   */
  parseQueryParameters_(url) {
    if (typeof url !== "string") {
      throw new Error(
        "Please provide a valid URL (String) including query parameters.",
      );
    }
    const [baseUrl, query] = url.split("?");
    if (!query) {
      return { url: baseUrl, queryParameters: null };
    }
    const queryParameters = query.split("&").reduce((acc, param) => {
      const [key, rawValue] = param.split("=");
      if (!key) return acc;
      const k = key.trim();
      let v = rawValue ? rawValue.trim() : "";
      v = isNaN(Number(v)) || v === "" ? v : Number(v);
      if (acc[k]) {
        acc[k].push(v);
      } else {
        acc[k] = [v];
      }
      return acc;
    }, {});
    return { url: baseUrl, queryParameters };
  }

  /**
   * Helper: Map JSON definitions as parameter endpoints uniformly.
   * @private
   */
  addQueryParameters_(url, obj) {
    if (typeof url !== "string" || typeof obj !== "object" || obj === null) {
      throw new Error(
        "Please provide a valid URL (String) and query parameter object.",
      );
    }
    const entries = Object.entries(obj);
    if (entries.length === 0) return url;

    const queryString = entries
      .flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${encodeURIComponent(k)}=${encodeURIComponent(e)}`)
          : `${encodeURIComponent(k)}=${encodeURIComponent(v)}`,
      )
      .join("&");

    return url.includes("?")
      ? `${url}&${queryString}`
      : `${url}?${queryString}`;
  }
};
