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
 * Author: Kanshi Tanaike
 * Version: 2.1.3
 * 20260512 12:00
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
   * @param {LockService.Lock} services.lock Lock service instance.
   * @param {PropertiesService.Properties} services.properties Properties service instance.
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
   * Method for the A2A server side logic.
   *
   * @param {Object} object Parameters object.
   * @param {Object} object.eventObject Event object from doPost/doGet.
   * @param {String} object.apiKey API key for Gemini.
   * @param {Function} object.agentCard Getter function for agent card object.
   * @param {Function} object.functions Getter function for functions object.
   * @return {ContentService.TextOutput}
   */
  server(object = {}) {
    console.log("Server side");
    this.errorProcess_(object);
    let id = "No ID";
    const lock = this.lock;

    // Server-side locking to prevent race conditions
    if (!lock.tryLock(350000)) {
      const msg = "Timeout.";
      console.error(msg);
      return this.createErrorResponse_(
        `Internal server error. Error message: ${msg}`,
        id,
        null,
      );
    }

    try {
      const { eventObject, agentCardUrls = [], agentCards = [] } = object;
      const obj = eventObject.postData ? this.parseObj_(eventObject) : {};
      id = obj.id || "No ID";

      // Handle Agent Card retrieval logic
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
        null,
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
    console.log("Client side");
    const lock = this.lock;

    // Client-side locking
    if (!lock.tryLock(350000)) {
      const msg = "Timeout.";
      console.error(msg);
      const errObj = {
        error: { message: `Internal server error. Error message: ${msg}` },
      };
      this.addLog_(
        this.date,
        null,
        null,
        "client side",
        JSON.stringify(errObj),
      );
      this.log_();
      return errObj;
    }

    try {
      const { agentCardUrls = [], agentCards = [] } = object;
      if (agentCards.length === 0 && agentCardUrls.length > 0) {
        object.agentCards = this.getAgentCards(agentCardUrls);
      }

      const res = this.processAgents_(object);
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
        this.date,
        null,
        null,
        "client side",
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
  addLog_(date, method, id, direction, message) {
    if (this.log) {
      this.values.push([date, method, id, direction, message]);
    }
  }

  /**
   * Helper: Create formatted Server Error Response.
   * @private
   */
  createErrorResponse_(message, id, method) {
    const errObj = {
      jsonrpc: this.jsonrpc,
      error: { code: this.ErrorCode["Internal server error"], message },
      id,
    };
    this.addLog_(
      this.date,
      method,
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

    // 1. Handle Discovery (Agent Card)
    if (
      pathInfo === ".well-known/agent.json" ||
      pathInfo === ".well-known/agent-card.json"
    ) {
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
        this.date,
        null,
        id,
        "server --> client",
        JSON.stringify(agentCardObj),
      );
      return this.createContent_(agentCardObj);
    }

    if (!obj.method) return null;
    const method = obj.method.toLowerCase();
    this.addLog_(
      this.date,
      method,
      id,
      "client --> server",
      JSON.stringify(obj),
    );

    // 2. Authentication Check
    if (this.accessKey && parameter.accessKey !== this.accessKey) {
      this.addLog_(this.date, method, id, "At server", "Invalid accessKey.");
      const errObj = {
        jsonrpc: this.jsonrpc,
        error: {
          code: this.ErrorCode["Authorization failed"],
          message: "Authorization failed. Invalid access key.",
        },
        id,
      };
      this.addLog_(
        this.date,
        method,
        id,
        "server --> client",
        JSON.stringify(errObj),
      );
      return this.createContent_(errObj);
    }

    // 3 & 4. Handle 'message/send' and 'tasks/send' seamlessly
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
        const { message } = params;
        const prompt = message?.parts?.[0]?.text || "";

        const { result, history } = this.processAgents_({
          apiKey,
          prompt,
          functions: functions(),
          fileAsBlob: true,
          agentCards,
        });

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
                    timestamp: this.date.toISOString(),
                  },
                  artifacts,
                },
                id,
              };

        this.addLog_(
          this.date,
          method,
          id,
          "server --> client",
          JSON.stringify(resObj),
        );
        return this.createContent_(resObj);
      } catch (err) {
        console.error(err.stack);
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
        console.warn("Failed to parse postData contents.", err);
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
      console.error("Failed to write to log sheet.", err);
    }
  }

  /**
   * Prepare client-side functions inclusive of remote agents.
   * @private
   */
  getClientFunctions_(agentCards, addedFunctions) {
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
        console.log("--- without_agent");
        console.log(`--- Prompt: ${task}`);
        return { task, result: response };
      },
    };

    // Integrate Discovered AI agents
    if (agentCards.length > 0) {
      agentCards.forEach(({ name, description, url, provider, skills }) => {
        const safeName = name.replace(/ /g, "_");
        const skillStr = skills
          .map(
            (o) =>
              `id: ${o.id}, name: ${o.name}, description: ${o.description}, examples: ${o.examples.join(", ")}`,
          )
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
        funcs[safeName] = ({ agent_name, agent_url, task }) => {
          console.log(`--- with_agent: "${agent_name}"`);
          console.log(`--- Prompt: ${task}`);

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
              message: { role: "user", parts: [{ type: "text", text: task }] },
              acceptedOutputModes: ["text", "text/plain"],
            },
          };

          this.addLog_(
            this.date,
            null,
            null,
            "client --> server",
            JSON.stringify(resObj),
          );

          return {
            agent_name,
            task,
            agent_url,
            request: {
              url: agent_url,
              payload: JSON.stringify(resObj),
              headers: this.headers,
              muteHttpExceptions: true,
            },
            resObj,
          };
        };
      });
    }

    // Merge User's custom defined implementations
    if (addedFunctions?.params_) {
      funcs.params_ = { ...funcs.params_, ...addedFunctions.params_ };
      Object.keys(addedFunctions).forEach((k) => {
        if (k !== "params_") funcs[k] = addedFunctions[k];
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
   * Retrieve and parse agent cards optimally from given URLs.
   * @param {Array<String>} agentCardUrls Array of strings referring to remote card sources.
   * @return {Array<Object>} Array of sanitized agent card objects.
   */
  getAgentCards(agentCardUrls) {
    console.log("--- start: Get agent card");
    if (!agentCardUrls || agentCardUrls.length === 0) {
      console.warn("No agent cards.");
      return [];
    }

    const requests = agentCardUrls.map((u) => {
      const { url, queryParameters } = this.parseQueryParameters_(u);
      const path = url.split("/").pop();
      const targetUrl = ["exec", "dev"].includes(path)
        ? `${url.trim()}/.well-known/agent-card.json`
        : url.trim();

      return {
        url: this.addQueryParameters_(targetUrl, queryParameters || {}),
        headers: this.headers,
        muteHttpExceptions: true,
      };
    });

    const ress = this.fetchAllWithLimitations_(requests);
    const agentCards = ress.reduce((acc, res, i) => {
      if (res.getResponseCode() === 200) {
        try {
          const o = JSON.parse(res.getContentText());
          o.url = o.url || agentCardUrls[i];
          if (o.name) {
            o.name = o.name.replace(/ /g, "_");
          }
          acc.push(o);
        } catch (e) {
          console.warn(
            `Failed to parse agent card from "${agentCardUrls[i]}".`,
          );
        }
      } else {
        console.warn(
          `Didn't get agent card from "${agentCardUrls[i]}". Status: ${res.getResponseCode()}`,
        );
      }
      return acc;
    }, []);

    if (agentCards.length === 0) {
      console.warn("No agent cards found.");
    }

    console.log("--- end: Get agent card");
    return agentCards;
  }

  /**
   * Core execution orchestration engine for handling prompt assignments dynamically.
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
    const addedFunctions = functions ? { ...functions } : null;
    const createdFunctions = this.getClientFunctions_(
      agentCards,
      addedFunctions,
    );

    console.log("--- start: Analyze prompt and select agents.");

    let agents = agentCards.map(({ name, description, url, skills }) => {
      const skillStr = skills.map(
        (e) =>
          `Skill name: ${e.name}, Description of skill: ${e.description}, Examples: ${e.examples.join(",")}`,
      );
      return `- Name: "${name}", Description: "${description}", URL: "${url}", skills: "${skillStr}"`;
    });
    if (agents.length === 0) agents = ["No agents."];

    let functionCallings = Object.entries(createdFunctions.params_).map(
      ([k, v]) => `- Name: "${k}", Details: ${JSON.stringify(v)}`,
    );
    if (functionCallings.length === 0) functionCallings = ["No functions."];

    this.addLog_(
      this.date,
      null,
      null,
      "server --> client",
      JSON.stringify(agents),
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
    const orderAr = g.generateContent({ q: textPrompt });

    forDebug && toLog_("orderAr", JSON.stringify(orderAr));

    if (!Array.isArray(orderAr) || orderAr.length === 0) {
      const errObj = {
        error: {
          code: this.ErrorCode["Internal server error"],
          message: "Internal server error. Try again.",
        },
        jsonrpc: this.jsonrpc,
        id: null,
      };
      this.addLog_(
        this.date,
        null,
        null,
        "Client side",
        JSON.stringify(errObj),
      );
      return errObj;
    }

    console.log("--- start: Process result.");
    let tempHistory = [...g.history];
    const results = [];

    // Evaluate the sequential path sequentially
    for (const { name, task } of orderAr) {
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
      forDebug && toLog_("In task loop", JSON.stringify(res));

      const funcRes = res.functionResponse;

      // Handle the resulting operation appropriately whether standard Function or A2A
      if (funcRes?.request) {
        const req = funcRes.request;
        const re = UrlFetchApp.fetch(req.url, req);

        if (re.getResponseCode() === 200) {
          const oo = JSON.parse(re.getContentText());
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
              const m = [...messageParts, ...sArtifacts];

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

              const lastHistory = gg.history[gg.history.length - 1];
              if (lastHistory?.parts?.[0]?.functionResponse?.response) {
                lastHistory.parts[0].functionResponse.response.content =
                  bkHistory;
              }
            } else {
              results.push(`Error: ${name}, ${task}`);
            }
          } else if (oo.error) {
            results.push(
              `Error: ${name}, ${task}. ${JSON.stringify(oo.error)}`,
            );
          }
        } else {
          results.push(`Error: ${name}, ${task}`);
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
        results.push({
          error: `Error: Name: ${name}, Task: ${task}, Result: ${JSON.stringify(res)}`,
        });
      }
      tempHistory = gg.history;
    }

    // Isolate Final structural outcomes vs physical data allocations (Files vs Textual)
    let finalResults = results.map((o) => {
      const type = o.type;
      if (type === "text") {
        console.log("Generate content with agents. Return as a text.");
        return o[type] || o.text;
      }

      console.log("Generate content with agents. Return as a file content.");
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

    // Aggregate textual extractions correctly saving network overhead globally
    const strResults = finalResults.filter((e) => typeof e === "string");
    if (strResults.length > 0) {
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
      g.history = gg.history;
      finalResults = [
        res3,
        ...finalResults.filter((e) => typeof e !== "string"),
      ];
    } else {
      g.history = tempHistory;
    }

    this.addLog_(
      this.date,
      null,
      null,
      "Client side",
      JSON.stringify(finalResults),
    );

    console.log("--- end: Process result.");
    forDebug && toLog_("finalResults2", JSON.stringify(finalResults));

    return { result: finalResults, history: g.history, agentCards };
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
   * Helper: Map JSON definitions as parameter endpoints appending uniformly.
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
