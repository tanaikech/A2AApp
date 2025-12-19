/**
 * This is for debug.
 */
const forDebug = false; // If this is true, a log is output.
const toLog_ = (kind, text) => {
  const spreadsheetId = "###";
  const sheetName = "rawA2AAppLog";
  const sheet = SpreadsheetApp.openById(spreadsheetId).getSheetByName(sheetName);
  sheet.appendRow([new Date(), kind, text]);
}

/**
 * Class object for A2AApp.
 * This is used for building both an Agent2Agent (A2A) server and an A2A client with Google Apps Script.
 * 
 * Author: Kanshi Tanaike
 * Version: 2.1.0
 * @class
 */
class A2AApp {

  /**
  * @param {Object} object Configuration object.
  * @param {String} object.accessKey Access key for A2A server (optional).
  * @param {Boolean} object.log Enable logging to Google Sheets (default: false).
  * @param {String} object.spreadsheetId Spreadsheet ID for logs.
  * @param {String} object.model Model name (default: "models/gemini-3-flash-preview").
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
      const ss = spreadsheetId ? SpreadsheetApp.openById(spreadsheetId) : SpreadsheetApp.create("Log_A2AApp");
      /** @private */
      this.sheet = ss.getSheetByName("log") || ss.insertSheet("log");
    }

    /** @private */
    this.values = [];

    /** @private */
    this.headers = { authorization: "Bearer " + ScriptApp.getOAuthToken() };

    /** 
     * TaskState Enum
     * Ref: https://google.github.io/A2A/specification/#63-taskstate-enum
     * @private
     */
    this.TaskState = {
      submitted: 'submitted',
      working: 'working',
      input_required: 'input-required',
      completed: 'completed',
      canceled: 'canceled',
      failed: 'failed',
      unknown: 'unknown',
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
      "A required resource is unavailable": -32011
    };

    // Initialize lock service (can be overridden by setServices)
    this.lock = this.lock || LockService.getScriptLock();
    this.properties = this.properties || PropertiesService.getScriptProperties();
  }

  /**
  * ### Description
  * Set services depend on each script. 
  * 
  * @param {Object} services Object containing services.
  * @param {LockService.Lock} services.lock Lock service instance.
  * @param {PropertiesService.Properties} services.properties Properties service instance.
  * @return {A2AApp}
  */
  setServices(services) {
    const { lock, properties } = services;
    if (lock && lock.toString() == "Lock") {
      this.lock = lock;
    }
    if (properties && properties.toString() == "Properties") { // Fixed check logic
      this.properties = properties;
    }
    return this;
  }

  /**
  * ### Description
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
    if (lock.tryLock(350000)) {
      try {
        let obj = {};
        if (object.eventObject.postData) {
          obj = this.parseObj_(object.eventObject);
          if (obj.hasOwnProperty("id")) {
            id = obj.id;
          }
        }

        // Handle Agent Card retrieval logic
        const { agentCardUrls = [], agentCards = [] } = object;
        if (agentCards.length == 0 && agentCardUrls.length > 0) {
          object.agentCards = this.getAgentCards(agentCardUrls);
        }

        const res = this.createResponse_({ ...object, obj, id });

        if (this.log) {
          this.log_();
        }
        return res;
      } catch ({ stack }) {
        console.error(stack);
        const err = "Internal server error";
        const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Error message: ${stack}` }, "jsonrpc": this.jsonrpc, id };
        this.values.push([this.date, null, id, "server --> client", JSON.stringify(errObj)]);
        if (this.log) {
          this.log_();
        }
        return this.createContent_(errObj);
      } finally {
        lock.releaseLock();
      }
    } else {
      console.error("Timeout.");
      const err = "Internal server error";
      const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Error message: Timeout.` }, "jsonrpc": this.jsonrpc, id };
      this.values.push([this.date, null, id, "server --> client", JSON.stringify(errObj)]);
      if (this.log) {
        this.log_();
      }
      return this.createContent_(errObj);
    }
  }

  /**
  * ### Description
  * Method for the A2A client side logic.
  *
  * @param {Object} object Parameters object.
  * @return {Object} Result object including result, history, and agentCards.
  */
  client(object = {}) {
    console.log("Client side");
    const lock = this.lock;
    // Client-side locking
    if (lock.tryLock(350000)) {
      try {
        const { agentCardUrls = [], agentCards = [] } = object;
        if (agentCards.length == 0 && agentCardUrls.length > 0) {
          object.agentCards = this.getAgentCards(agentCardUrls);
        }
        const res = this.processAgents_(object);
        if (this.log) {
          this.log_();
        }
        return res;
      } catch ({ stack }) {
        console.error(stack);
        const err = "Internal server error";
        const errObj = { "error": { "message": `${err}. Error message: ${stack}` } };
        this.values.push([this.date, null, null, "client side", JSON.stringify(errObj)]);
        if (this.log) {
          this.log_();
        }
        return errObj;
      } finally {
        lock.releaseLock();
      }
    } else {
      console.error("Timeout.");
      const err = "Internal server error";
      const errObj = { "error": { "message": `${err}. Error message: Timeout.` } };
      this.values.push([this.date, null, null, "client side", JSON.stringify(errObj)]);
      if (this.log) {
        this.log_();
      }
      return errObj;
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
  * Create response for the server.
  * @private
  */
  createResponse_(object) {
    const { eventObject, apiKey, agentCard, functions, agentCards = [], agentCardUrls = [], obj, id } = object;
    const { pathInfo } = eventObject;

    // 1. Handle Discovery (Agent Card)
    if (pathInfo == ".well-known/agent.json" || pathInfo == ".well-known/agent-card.json") {
      if (!agentCard || typeof agentCard != "function") {
        throw new Error("Agent card was not found or is not a function.");
      }
      // agentCard is passed as a getter function
      const agentCardObj = agentCard();

      agentCards.forEach(({ description = "", skills = [], defaultInputModes = [], defaultOutputModes = [] }) => {
        agentCardObj.description += "\n" + description;
        agentCardObj.skills.push(...skills);
        agentCardObj.defaultInputModes.push(...defaultInputModes);
        agentCardObj.defaultOutputModes.push(...defaultOutputModes);
        // De-duplicate
        agentCardObj.skills = [...new Set(agentCardObj.skills)];
        agentCardObj.defaultInputModes = [...new Set(agentCardObj.defaultInputModes)];
        agentCardObj.defaultOutputModes = [...new Set(agentCardObj.defaultOutputModes)];
      });
      this.values.push([this.date, null, id, "server --> client", JSON.stringify(agentCardObj)]);
      return this.createContent_(agentCardObj);
    }

    if (!obj.hasOwnProperty("method")) return null;
    const method = obj.method.toLowerCase();
    this.values.push([this.date, method, id, "client --> server", JSON.stringify(obj)]);

    // 2. Authentication Check
    if (
      (this.accessKey && !eventObject.parameter.accessKey) ||
      (this.accessKey && eventObject.parameter.accessKey && eventObject.parameter.accessKey != this.accessKey)
    ) {
      this.values.push([this.date, method, id, "At server", "Invalid accessKey."]);
      const err = "Authorization failed";
      const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Invalid access key.` }, "jsonrpc": this.jsonrpc, id };
      this.values.push([this.date, method, id, "server --> client", JSON.stringify(errObj)]);
      return this.createContent_(errObj);
    }

    // 3. Handle 'message/send'
    if (method == "message/send" && functions) {
      let resObj;
      let messageId;
      try {
        if (typeof functions != "function") {
          const err = "Internal server error";
          const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Invalid functions.` }, "jsonrpc": this.jsonrpc, id };
          this.values.push([this.date, method, id, "server --> client", JSON.stringify(errObj)]);
          return this.createContent_(errObj);
        }
        const { params } = obj;
        const { message } = params;
        messageId = params.messageId;
        const prompt = message.parts[0].text;

        const { result, history } = this.processAgents_({
          apiKey,
          prompt,
          functions: functions(), // Call the getter
          fileAsBlob: true,
          agentCards,
        });

        // Normalize results
        for (let i = 0; i < result.length; i++) {
          if (typeof result[i] == "string") {
            result[i] = { type: "text", kind: "text", text: result[i] };
          }
        }

        // Construct response parts
        const { messageParts } = result.reduce((o, e, i) => {
          const type = e.type;
          if (type == "text") {
            const gg = new GeminiWithFiles({ apiKey, model: this.model, history });
            const res = gg.generateContent({
              parts: [
                { text: `Summarize answers by considering the question.` },
                { text: `<Question>${prompt}</Question>` },
                { text: `<Answers>${e[e.type]}</Answers>` }
              ]
            });
            o.messageParts.push({ type: "text", kind: "text", text: res });
            o.artifacts.push({ name: "Answer", index: i, parts: [{ type: "text", kind: "text", text: res }] });
          } else {
            if (type != "file" && type != "data") {
              o.messageParts.push(e);
            } else {
              o.messageParts.push({ type: "text", kind: "text", text: `The data "${e[type].name}" was downloaded.` });
            }
            o.artifacts.push({ name: "Answer", index: i, parts: [e] });
          }
          return o;
        }, { artifacts: [], messageParts: [] });

        resObj = {
          jsonrpc: this.jsonrpc,
          result: {
            kind: "message",
            messageId,
            parts: messageParts,
            role: "agent"
          },
          id
        };
      } catch ({ stack }) {
        console.error(stack);
        const err = "Internal server error";
        resObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Error message: ${stack}` }, "jsonrpc": this.jsonrpc, id };
      }

      this.values.push([this.date, method, id, "server --> client", JSON.stringify(resObj)]);
      return this.createContent_(resObj);

      // 4. Handle 'tasks/send'
    } else if (method == "tasks/send" && functions) {
      let resObj;
      let paramsId, sessionId;
      try {
        if (typeof functions != "function") {
          const err = "Internal server error";
          const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Invalid functions.` }, "jsonrpc": this.jsonrpc, id };
          this.values.push([this.date, method, id, "server --> client", JSON.stringify(errObj)]);
          return this.createContent_(errObj);
        }
        const { params } = obj;
        const { message } = params;
        paramsId = params.id;
        sessionId = params.sessionId;
        const prompt = message.parts[0].text;

        const { result, history } = this.processAgents_({
          apiKey,
          prompt,
          functions: functions(), // Call the getter
          fileAsBlob: true,
          agentCards,
        });

        for (let i = 0; i < result.length; i++) {
          if (typeof result[i] == "string") {
            result[i] = { type: "text", kind: "text", text: result[i] };
          }
        }

        const { artifacts, messageParts } = result.reduce((o, e, i) => {
          const type = e.type;
          if (type == "text") {
            const gg = new GeminiWithFiles({ apiKey, model: this.model, history });
            const res = gg.generateContent({
              parts: [
                { text: `Summarize answers by considering the question.` },
                { text: `<Question>${prompt}</Question>` },
                { text: `<Answers>${e[e.type]}</Answers>` }
              ]
            });
            o.messageParts.push({ type: "text", kind: "text", text: res });
            o.artifacts.push({ name: "Answer", index: i, parts: [{ type: "text", kind: "text", text: res }] });
          } else {
            if (type != "file" && type != "data") {
              o.messageParts.push(e);
            } else {
              o.messageParts.push({ type: "text", kind: "text", text: `The data "${e[type].name}" was downloaded.` });
            }
            o.artifacts.push({ name: "Answer", index: i, parts: [e] });
          }
          return o;
        }, { artifacts: [], messageParts: [] });

        resObj = {
          jsonrpc: this.jsonrpc,
          result: {
            kind: "task",
            id: paramsId,
            sessionId: sessionId,
            status: {
              state: this.TaskState.completed,
              message: { role: "agent", parts: messageParts },
              timestamp: this.date.toISOString()
            },
            artifacts
          },
          id,
        };
      } catch ({ stack }) {
        console.error(stack);
        const err = "Internal server error";
        resObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Error message: ${stack}` }, "jsonrpc": this.jsonrpc, id };
      }

      this.values.push([this.date, method, id, "server --> client", JSON.stringify(resObj)]);
      return this.createContent_(resObj);
    }

    return null;
  }

  /**
  * Parse postData contents.
  * @private
  */
  parseObj_(e) {
    let obj = {};
    if (e.postData.contents) {
      obj = JSON.parse(e.postData.contents);
    }
    return obj;
  }

  /**
  * Create JSON TextOutput.
  * @private
  */
  createContent_(data) {
    const d = typeof data == "object" ? JSON.stringify(data) : data;
    return ContentService.createTextOutput(d).setMimeType(ContentService.MimeType.JSON);
  }

  /**
  * Log to Spreadsheet.
  * @private
  */
  log_() {
    if (this.values.length == 0) return;
    this.values = this.values.map(r => r.map(c => typeof c == "string" ? c.substring(0, 40000) : c));
    this.sheet.getRange(this.sheet.getLastRow() + 1, 1, this.values.length, this.values[0].length).setValues(this.values);
  }

  /**
   * Prepare client-side functions including remote agents.
   * @private
   */
  getClientFunctions_(agentCards, addedFunctions) {
    let funcs = {
      params_: {
        without_agent: {
          description: "Use this, if the agent and other functions can not resolve the tasks.",
          parameters: {
            type: "object",
            properties: {
              task: {
                type: "string",
                description: "Details of task."
              },
              response: {
                type: "string",
                description: "Response to the task."
              },
            },
            required: ["task", "response"]
          }
        },
      },

      without_agent: ({ task, response }) => {
        console.log("--- without_agent");
        console.log(`--- Prompt: ${task}`);
        return { task, result: response };
      },
    };

    // Add AI agents.
    if (agentCards.length > 0) {
      agentCards.forEach(({ name, description, url, provider, skills }) => {
        name = name.replace(/ /g, "_");
        const skillStr = skills.map(o => `id: ${o.id}, name: ${o.name}, description: ${o.description}, examples: ${o.examples.join("\n")}`);
        const tempParams = {
          description: [
            `Agent name: ${name}`,
            `Drscription: ${description}`,
            `URL: ${url}`,
            `Skills: ${skillStr}`,
            provider ? `Provider: ${provider.organization}, ${provider.url}` : "",
          ].join("\n"),
          parameters: {
            type: "object",
            properties: {
              agent_name: {
                type: "string",
                description: "Agent name you selected."
              },
              agent_url: {
                type: "string",
                description: "URL of the agent."
              },
              task: {
                type: "string",
                description: "Details of task. Give the suitable task to this agent."
              },
            },
            required: ["agent_name", "agent_url", "task"]
          }
        };
        funcs.params_[name] = tempParams;

        // Define the proxy function to call remote agent
        funcs[name] = ({ agent_name, agent_url, task }) => {
          console.log(`--- with_agent: "${agent_name}"`);
          console.log(`--- Prompt: ${task}`);
          const id1 = Utilities.newBlob(new Date().getTime()).getBytes().map(byte => ('0' + (byte & 0xFF).toString(16)).slice(-2)).join('');
          const id2 = Utilities.getUuid();
          const id3 = Utilities.getUuid();
          const resObj = {
            jsonrpc: this.jsonrpc,
            id: id1,
            method: "tasks/send",
            params:
            {
              id: id2,
              sessionId: id3,
              message: { role: "user", parts: [{ type: "text", text: task }], },
              acceptedOutputModes: ['text', 'text/plain'],
            }
          };
          this.values.push([this.date, null, null, "client --> server", JSON.stringify(resObj)]);
          return {
            agent_name,
            task,
            agent_url,
            request: { url: agent_url, payload: JSON.stringify(resObj), headers: this.headers, muteHttpExceptions: true },
            resObj
          };
        };
      });
    }

    // Add user's custom functions.
    if (addedFunctions && addedFunctions.params_) {
      funcs.params_ = { ...funcs.params_, ...addedFunctions.params_ };
      const keys = Object.keys(addedFunctions.params_);
      funcs = { ...funcs, ...Object.fromEntries(keys.map(k => [k, addedFunctions[k]])) };
    }
    return funcs;
  }

  /**
  * Fetch multiple URLs in chunks to avoid limits.
  * @private
  */
  fetchAllWithLimitations_(requests, limit = 20) {
    if (requests.length > 0) {
      const ar = [...requests];
      const reqs = [...Array(Math.ceil(ar.length / limit))].map((_) => ar.splice(0, limit));
      const res = reqs.flatMap(e => UrlFetchApp.fetchAll(e));
      return res;
    }
    return [];
  }

  /**
  * Retrieve and parse agent cards from URLs.
  * @return {Array} Array of agent card objects.
  */
  getAgentCards(agentCardUrls) {
    console.log("--- start: Get agent card");
    if (agentCardUrls.length == 0) {
      console.warn("No agent cards.");
      return [];
    }
    const callAgentCardUrls = agentCardUrls.map(u => {
      const { url, queryParameters } = this.parseQueryParameters_(u);
      const path = url.split("/").pop();
      const targetUrl = ["exec", "dev"].includes(path)
        ? `${url.trim()}/.well-known/agent-card.json`
        : `${url.trim()}/.well-known/agent-card.json`;

      return {
        url: this.addQueryParameters_(targetUrl, queryParameters || {}),
        headers: this.headers,
        muteHttpExceptions: true
      };
    });

    const ress = this.fetchAllWithLimitations_(callAgentCardUrls);
    const agentCards = ress.reduce((ar, res, i) => {
      if (res.getResponseCode() == 200) {
        try {
          const o = JSON.parse(res.getContentText());
          if (!o.hasOwnProperty("url")) {
            o.url = agentCardUrls[i];
          }
          o.name = o.name.replace(/ /g, "_");
          ar.push(o);
        } catch (e) {
          console.warn(`Failed to parse agent card from "${agentCardUrls[i]}".`);
        }
      } else {
        console.warn(`Didn't get agent card from "${agentCardUrls[i]}". Status: ${res.getResponseCode()}`);
      }
      return ar;
    }, []);

    if (agentCards.length == 0) {
      console.warn("No agent cards found.");
    }
    console.log("--- end: Get agent card");
    return agentCards;
  }

  /**
  * Core logic for processing agents with Gemini.
  * @private
  */
  processAgents_(object) {
    const { apiKey, agentCards, prompt = "", history = [], fileAsBlob = false, functions } = object;
    let addedFunctions = null;
    if (functions) {
      addedFunctions = { ...functions };
    }

    const createdFunctions = this.getClientFunctions_(agentCards, addedFunctions);

    console.log("--- start: Analyze prompt and select agents.");
    let agents = agentCards.map(({ name, description, url, skills }) => {
      const skillStr = skills.map(e => `Skill name: ${e.name}, Description of skill: ${e.description}, Examples: ${e.examples.join(",")}`);
      return `- Name: "${name}", Description: "${description}", URL: "${url}", skills: "${skillStr}"`;
    });
    if (agents.length == 0) {
      agents = ["No agents."];
    }
    let functionCallings = Object.entries(createdFunctions.params_).map(([k, v]) => (
      `- Name: "${k}", Detals: ${JSON.stringify(v)}`
    ));
    if (functionCallings.length == 0) {
      functionCallings = ["No functions."];
    }
    this.values.push([this.date, null, null, "server --> client", JSON.stringify(agents)]);

    // Construct System Instruction for Gemini
    const systemInstructionText = [
      "You are an expert delegator capable of assigning user requests to appropriate remote agents. You create the suitable order for processing agents and functions.",
      "<Agents>",
      "The following agents are the available agent list.",
      ...agents,
      "</Agents>",
      "<Functions>",
      "The following functions are the available function list. The JSON schema of the value of 'Detals' is the same with the schema for the function calling. From 'Details', understand the functions.",
      ...functionCallings,
      "</Functions>",
      "<Mission>",
      "- Understand the agents and the tasks that the agents can do.",
      "- Understand the functions and the tasks that the functions can do.",
      "- Understand requests of the user's prompt.",
      "- For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions for accurately resolving requests of the user's prompt in the suitable order. Always include the remote agent's name and the function name when responding to the user.",
      "If multiple processes can be run with a single agent or a function, create a suitable prompt including those processes in it.",
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
      description: "Suggest the suitable order of the agents and the functions to resolve the user's prompt.",
      type: "array",
      items: {
        type: "object",
        properties: {
          name: { description: "Agent name or function name.", type: "string" },
          task: { description: "For actionable tasks that the agents and the functions can do, select a suitable one of the given agents and functions to accurately resolve requests of the user's prompt in the suitable order. Here, don't include the agent URL.", type: "string" },
        },
      },
    };

    // Call Gemini to plan execution
    const obj = {
      apiKey,
      systemInstruction: { parts: [{ text: systemInstructionText }], role: "model" },
      model: this.model,
      responseMimeType: "application/json",
      responseSchema,
    };
    const g = new GeminiWithFiles(obj);
    g.history = [...history, ...g.history];
    const textPrompt = [
      "User's prompt is as follows.",
      `<UserPrompt>${prompt}</UserPrompt>`,
    ].join("\n");
    const orderAr = g.generateContent({ q: textPrompt });

    forDebug && toLog_("orderAr", JSON.stringify(orderAr))

    if (!Array.isArray(orderAr) || orderAr.length == 0) {
      const err = "Internal server error";
      const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Try again.` }, "jsonrpc": this.jsonrpc, id: null };
      this.values.push([this.date, null, null, "Client side", JSON.stringify(errObj)]);
      return errObj;
    }

    console.log("--- start: Process result.");
    let tempHistory = [...g.history];

    // Execute planned agents/functions
    const results = orderAr.reduce((ar, { name, task }, i) => {
      const funcCall = {
        params_: { [name]: createdFunctions.params_[name] },
        [name]: createdFunctions[name]
      };
      const obj = {
        apiKey,
        model: this.model,
        functions: funcCall,
        history: tempHistory,
        toolConfig: {
          functionCallingConfig: {
            mode: "any",
            allowedFunctionNames: [name]
          }
        },
      };
      const gg = new GeminiWithFiles(obj);
      const q = [
        `Your task is as follows.`,
        `<Task>${task}</Task>`,
        `<Important>`,
        `- If you do not have enough information to resolve "Task", ask the user for more details without generating content forcefully.`,
        `</Important>`,
      ];
      const res = gg.generateContent({ q: q.join("\n") });

      forDebug && toLog_("In task loop", JSON.stringify(res));

      // Handle response from Function Call (Remote Agent or Local Function)
      if (res.functionResponse?.request) {
        // Calling remote A2A agent
        const re = UrlFetchApp.fetchAll([res.functionResponse?.request])[0];
        if (re.getResponseCode() == 200) {
          const oo = JSON.parse(re.getContentText());
          if (oo.result) {
            const id1 = res.functionResponse.resObj.id;
            const id2 = res.functionResponse.resObj.params.id;
            const id3 = res.functionResponse.resObj.params.sessionId;
            if (oo.result.status.state == "completed" && oo.id == id1 && oo.result?.id == id2 && oo.result?.sessionId == id3) {
              const sArtifacts = oo.result.artifacts.flatMap(({ parts }) => parts);

              const message = oo.result.status.message;
              const m = [...message.parts, ...sArtifacts];
              ar.push(...m);
              let bkHistory = m.filter(mm => mm.type == "text");
              if (bkHistory.length == 0 && m.length > 0) {
                const sss = m.map(mm => `Name: ${mm[mm.type].name}, MimeType: ${mm[mm.type].mimeType}`).join("\n");
                bkHistory = { type: "text", text: `Data is as follows.\n${sss}` };
              }
              gg.history[gg.history.length - 1].parts[0].functionResponse.response.content = bkHistory;
            } else {
              ar.push(`Error: ${name}, ${task}`);
            }
          } else if (oo.error) {
            ar.push(`Error: ${name}, ${task}. ${JSON.stringify(oo.error)}`);
          }
        } else {
          ar.push(`Error: ${name}, ${task}`);
        }
      } else if (res.functionResponse?.result) {
        // Local function result
        let text = res.functionResponse.result;
        if (res.functionResponse.result?.content?.[0]?.text) {
          text = res.functionResponse.result?.content?.[0]?.text;
        }
        ar.push({ type: "text", text });
      } else if (res.functionResponse?.a2a && res.functionResponse?.a2a?.result) {
        // Special A2A specific result format
        ar.push({ type: "text", text: res.functionResponse.a2a.result });
      } else {
        ar.push({ error: `Error: Name: ${name}, Task: ${task}, Result: ${JSON.stringify(res)}` });
      }
      tempHistory = gg.history;
      return ar;
    }, []);

    // Format final results (Files vs Text)
    let finalResults = results.map(o => {
      const type = o.type;
      if (type == "text") {
        console.log("Generate content with agents. Return as a text.");
        return o[type];
      }

      console.log("Generate content with agents. Return as a file content.");
      const data = o[type];
      let fileBlob;
      if (data?.bytes) {
        fileBlob = Utilities.newBlob(Utilities.base64Decode(data.bytes), data.mimeType, data.name);
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

    // Final summarization if there are text results
    const strResults = finalResults.filter(e => typeof e == "string");
    if (strResults.length > 0) {
      const gg = new GeminiWithFiles({ apiKey, model: this.model, history: tempHistory });
      const res3 = gg.generateContent({
        parts: [
          { text: `Summarize answers by considering the question.` },
          { text: `<Question>${prompt}</Question>` },
          { text: `<Answers>${strResults.join("\n")}</Answers>` }
        ]
      });
      g.history = gg.history;
      finalResults = [res3, ...finalResults.filter(e => typeof e != "string")];
    }

    this.values.push([this.date, null, null, "Client side", JSON.stringify(finalResults)]);

    console.log("--- end: Process result.");
    forDebug && toLog_("finalResults2", JSON.stringify(finalResults));
    return { result: finalResults, history: g.history, agentCards };
  }

  /**
   * Helper: Parse URL query parameters.
   * @private
   */
  parseQueryParameters_(url) {
    if (url === null || typeof url != "string") {
      throw new Error("Please give URL (String) including the query parameters.");
    }
    const s = url.split("?");
    if (s.length == 1) {
      return { url: s[0], queryParameters: null };
    }
    const [baseUrl, query] = s;
    if (query) {
      const queryParameters = query.split("&").reduce(function (o, e) {
        const temp = e.split("=");
        const key = temp[0].trim();
        let value = temp[1].trim();
        value = isNaN(value) ? value : Number(value);
        if (o[key]) {
          o[key].push(value);
        } else {
          o[key] = [value];
        }
        return o;
      }, {});
      return { url: baseUrl, queryParameters };
    }
    return null;
  }

  /**
   * Helper: Add query parameters to URL.
   * @private
   */
  addQueryParameters_(url, obj) {
    if (url === null || obj === null || typeof url != "string") {
      throw new Error(
        "Please give URL (String) and query parameter (JSON object)."
      );
    }
    const o = Object.entries(obj);
    return (
      (url == "" ? "" : `${url}${o.length > 0 ? "?" : ""}`) +
      o.flatMap(([k, v]) =>
        Array.isArray(v)
          ? v.map((e) => `${k}=${encodeURIComponent(e)}`)
          : `${k}=${encodeURIComponent(v)}`
      )
        .join("&")
    );
  }
}