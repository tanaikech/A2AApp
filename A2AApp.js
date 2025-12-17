/**
 * Class object for A2AApp.
 * This is used for building both an Agent2Agent (A2A) server and an A2A client with Google Apps Script.
 * 
 * Author: Kanshi Tanaike
 * 20251216 16:30
 * version 2.0.4
 * @class
 */
class A2AApp {

  /**
  * @param {Object} object Object using this script.
  * @param {String} object.accessKey This is for the A2A server. Default is no value. This key is used for accessing the Web Apps.
  * @param {Boolean} object.log Default is false. When this is true, the log between A2A client and A2A server is stored to Google Sheets.
  * @param {String} object.spreadsheetId Spreadsheet ID. Log is storead to "log" sheet of this spreadsheet.
  */
  constructor(object = {}) {
    const { accessKey = null, log = false, spreadsheetId } = object;

    /** @private */
    this.accessKey = accessKey;

    /** @private */
    this.model = "models/gemini-2.5-flash";

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
    this.headers;

    /** 
     * TaskState Enum
     * Ref: https://google.github.io/A2A/specification/#63-taskstate-enum
     * @private
     */
    this.TaskState = {
      submitted: 'submitted', // Task received by server, acknowledged, but processing has not yet actively started.
      working: 'working', // Task is actively being processed by the agent.
      input_required: 'input-required', // Agent requires additional input from the client/user to proceed. (Task is paused)
      completed: 'completed', // Task finished successfully. (Terminal state)
      canceled: 'canceled', // Task was canceled by the client or potentially by the server. (Terminal state)
      failed: 'failed', // Task terminated due to an error during processing. (Terminal state)
      unknown: 'unknown', // The state of the task cannot be determined (e.g., task ID invalid or expired). (Effectively a terminal state from client's PoV for that ID)
    };

    /**
     * Error codes.
     * Ref: https://google.github.io/A2A/specification/#8-error-handling
     * @private
     */
    this.ErrorCode = {
      // Standard JSON-RPC Errors
      "Invalid JSON payload": -32700,
      "Invalid JSON-RPC Request": -32600,
      "Method not found": -32601,
      "Invalid method parameters": -32602,
      "Internal server error": -32603,
      "(Server-defined)": -32000,

      // A2A-Specific Errors
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

    /** @private */
    this.headers = { authorization: "Bearer " + ScriptApp.getOAuthToken() };

    this.lock = this.lock || LockService.getScriptLock();

    this.properties = this.properties || PropertiesService.getScriptProperties();
  }

  /**
  * ### Description
  * Set services depend on each script. For example, those are LockService and PropertiesService.
  * For example, if you don't set these properties, you cannot use this as a library.
  * If you want to use A2AApp as a library, please set the services.
  *
  * In the current stage, only LockService is used and PropertiesService is not used in A2AApp. PropertiesService is for the future update.
  *
  * @param {Object} services Array including the services you want to use.
  * @params {LockService.Lock} services.lock One of LockService.getDocumentLock(), LockService.getScriptLock(), or LockService.getUserLock(). Default is LockService.getScriptLock().
  * @params {PropertiesService.Properties} services.properties  One of PropertiesService.getDocumentProperties(), PropertiesService.getScriptProperties(), or PropertiesService.getUserProperties(). Default is PropertiesService.getScriptProperties().
  * @return {A2AApp}
  */
  setServices(services) {
    const { lock, properties } = services;
    if (lock && lock.toString() == "Lock") {
      this.lock = lock;
    }
    if (properties && lock.toString() == "Properties") {
      this.properties = properties;
    }
    return this;
  }

  /**
  * ### Description
  * Method for the A2A server.
  *
  * @param {Object} object Object using this script.
  * @param {Object} object.eventObject Event object from doPost and doGet functions.
  * @param {String} object.apiKey API key for using Gemini API.
  * @param {Object} object.agentCard Object for registering your agent card.
  * @param {Object} object.functions Functions.
  * @return {ContentService.TextOutput}
  */
  server(object = {}) {
    console.log("Server side");
    this.errorProcess_(object);
    let id = "No ID";
    const lock = this.lock;
    if (lock.tryLock(350000)) {
      try {
        let obj = {};
        if (object.eventObject.postData) {
          obj = this.parseObj_(object.eventObject);
          if (obj.hasOwnProperty("id")) {
            id = obj.id;
          }
        }
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
  * Method for the A2A client.
  *
  * @typedef {Object} ReturnObj
  * @property {Array} result Result value.
  * @property {Object} history History.
  * @property {Array} agentCards Agent cards.
  *
  * @param {Object} object Object using this script.
  * @param {String} object.apiKey API key for using Gemini API.
  * @param {String} object.agentCardUrls URLs for installing the agent card.
  * @param {String} object.prompt Prompt to Gemini
  * @param {Array} object.history History
  * @param {Boolean} object.fileAsBlob
  * @param {Array} object.agentCards
  * @param {Object} object.functions
  * @return {ReturnObj} Return value.
  */
  client(object = {}) {
    console.log("Client side");
    const lock = this.lock;
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
  * ### Description
  * Check parameters.
  *
  * @param {Object} object Object using this script.
  * @return {void}
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
  * ### Description
  * Create the response to A2A client.
  *
  * @param {Object} object Object using this script.
  * @param {Object} object.eventObject Event object from doPost function.
  * @param {String} object.apiKey API key for using Gemini API.
  * @param {Object} object.agentCard Object for agent card.
  * @param {Object} object.functions Functions.
  * @param {Array} object.agentCardUrls Agent Card URL.
  * @param {Object} object.obj
  * @param {String} object.id
  * @return {ContentService.TextOutput}
  * @private
  */
  createResponse_(object) {
    const { eventObject, apiKey, agentCard, functions, agentCards = [], agentCardUrls = [], obj, id } = object;
    const { pathInfo } = eventObject;
    if (pathInfo == ".well-known/agent.json" || pathInfo == ".well-known/agent-card.json") {
      if (!agentCard || typeof agentCard != "function") {
        throw new Error("Agent card was not found.");
      }
      const agentCardObj = agentCard();
      agentCards.forEach(({ description = "", skills = [], defaultInputModes = [], defaultOutputModes = [] }) => {
        agentCardObj.description += "\n" + description;
        agentCardObj.skills.push(...skills);
        agentCardObj.defaultInputModes.push(...defaultInputModes);
        agentCardObj.defaultOutputModes.push(...defaultOutputModes);
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
          functions: functions(),
          fileAsBlob: true,
          agentCards,
        });
        for (let i = 0; i < result.length; i++) {
          if (typeof result[i] == "string") {
            result[i] = { type: "text", kind: "text", text: result[i] };
          }
        }
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
          functions: functions(),
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
  * ### Description
  * Parse object of the request body from doPost.
  *
  * @param {Object} e Object
  * @return {Object} object
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
  * ### Description
  * Convert text to an object of ContentService.TextOutput.
  *
  * @param {Object|String} data JSON object or Text.
  * @return {ContentService.TextOutput} object
  * @private
  */
  createContent_(data) {
    const d = typeof data == "object" ? JSON.stringify(data) : data;
    return ContentService.createTextOutput(d).setMimeType(ContentService.MimeType.JSON);
  }

  /**
  * ### Description
  * Store logs to Google Sheets.
  *
  * @return {void}
  * @private
  */
  log_() {
    if (this.values.length == 0) return;
    this.values = this.values.map(r => r.map(c => typeof c == "string" ? c.substring(0, 40000) : c));
    this.sheet.getRange(this.sheet.getLastRow() + 1, 1, this.values.length, this.values[0].length).setValues(this.values);
  }


  /**
   * ### Description
   * This is an object including A2A agents and the user's custom functions.
   * You can see the specification of this object as follows.
   * Ref: https://github.com/tanaikech/GeminiWithFiles?tab=readme-ov-file#use-function-calling
   * 
   * @return {Object}
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
  * ### Description
  * fetchAll method with limitations.
  * Ref: https://github.com/tanaikech/taking-advantage-of-Web-Apps-with-google-apps-script?tab=readme-ov-file#limitation-of-simultaneous-connection-to-web-apps
  *
  * @param {Array} requests
  * @return {UrlFetchApp.HTTPResponse[]} Array including UrlFetchApp.HTTPResponse.
  * @private
  */
  fetchAllWithLimitations_(requests, limit = 20) {
    if (requests.length > 0) {
      const ar = [...requests];
      // Ref: https://github.com/tanaikech/UtlApp?tab=readme-ov-file#splitarray
      const reqs = [...Array(Math.ceil(ar.length / limit))].map((_) => ar.splice(0, limit));
      const res = reqs.flatMap(e => UrlFetchApp.fetchAll(e));
      return res;
    }
    return [];
  }

  /**
  * ### Description
  * Get agent cards.
  *
  * @param {Array} agentCardUrls
  * @return {Array} Array including agent cards.
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
      if (["exec", "dev"].includes(path)) { // <--- For Web Apps created by Google Apps Script
        return { url: this.addQueryParameters_(`${url.trim()}/.well-known/agent-card.json`, queryParameters || {}), headers: this.headers, muteHttpExceptions: true }; // for v0.3.0
        // return { url: this.addQueryParameters_(`${url.trim()}/.well-known/agent.json`, queryParameters || {}), headers: this.headers, muteHttpExceptions: true };
      }
      return { url: this.addQueryParameters_(`${url.trim()}/.well-known/agent-card.json`, queryParameters || {}), muteHttpExceptions: true }; // for v0.3.0
      // return { url: this.addQueryParameters_(`${url.trim()}/.well-known/agent.json`, queryParameters || {}), muteHttpExceptions: true };
    });
    const ress = this.fetchAllWithLimitations_(callAgentCardUrls);
    const agentCards = ress.reduce((ar, res, i) => {
      if (res.getResponseCode() == 200) {
        const o = JSON.parse(res.getContentText());
        if (!o.hasOwnProperty("url")) {
          o.url = agentCardUrls[i];
        }
        o.name = o.name.replace(/ /g, "_");
        ar.push(o);
      } else {
        console.warn(`Didn't get agent card from "${agentCardUrls[i]}".`);
      }
      return ar;
    }, []);
    if (agentCards.length == 0) {
      console.warn("No agent cards.");
    }
    console.log("--- end: Get agent card");
    return agentCards;
  }

  /**
  * ### Description
  * Processing the AI agents.
  *
  * @typedef {Object} ReturnObj
  * @property {Array} result Result value.
  * @property {Object} history History.
  * @property {Array} agentCards Agent cards.
  *
  * @param {Object} object Object using this script.
  * @param {String} object.apiKey API key for using Gemini API.
  * @param {String} object.agentCardUrls URLs for installing the agent card.
  * @param {String} object.prompt Prompt to Gemini
  * @param {Array} object.history History
  * @param {Boolean} object.fileAsBlob
  * @param {Array} object.agentCards
  * @param {Object} object.functions
  * @return {ReturnObj} Return value.
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

    // Ref: https://github.com/google/A2A/blob/18998ab681e886d8bb0512d2b358040290e97d18/samples/python/hosts/multiagent/host_agent.py
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
    if (!Array.isArray(orderAr) || orderAr.length == 0) {
      const err = "Internal server error";
      const errObj = { "error": { "code": this.ErrorCode[err], "message": `${err}. Try again.` }, "jsonrpc": this.jsonrpc, id };
      this.values.push([this.date, null, null, "Client side", JSON.stringify(errObj)]);
      return errObj;
    }
    console.log("--- start: Process result.");
    let tempHistory = [...g.history];
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

      if (res.functionResponse?.request) {
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

              // or gg.history[gg.history.length - 1].parts[0].functionResponse.response.content = sArtifacts;

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
        ar.push({ type: "text", text: res.functionResponse.result });
      } else if (res.functionResponse?.a2a && res.functionResponse?.a2a?.result) {
        ar.push({ type: "text", text: res.functionResponse.a2a.result });
      } else {
        ar.push({ error: `Error: Name: ${name}, Task: ${task}, Result: ${JSON.stringify(res)}` });
      }
      tempHistory = gg.history;
      return ar;
    }, []);

    let finalResults = results.map(o => {
      const type = o.type;
      if (type == "text") {
        console.log("Generate content with agents. Return as a text.");
        return o[type];
        // or return typeof o[type] == "object" ? JSON.stringify(o[type]) : o[type];
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
    return { result: finalResults, history: g.history, agentCards };
  }

  /**
   * Ref: https://github.com/tanaikech/UtlApp?tab=readme-ov-file#parsequeryparameters
   * 
   * ### Description
   * This method is used for parsing the URL including the query parameters.
   * Ref: https://tanaikech.github.io/2018/07/12/adding-query-parameters-to-url-using-google-apps-script/
   *
   * @param {String} url The URL including the query parameters.
   * @return {Object} JSON object including the base url and the query parameters.
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
   * Ref: https://github.com/tanaikech/UtlApp?tab=readme-ov-file#addqueryparameters
   * 
   * ### Description
   * This method is used for adding the query parameters to the URL.
   * Ref: https://tanaikech.github.io/2018/07/12/adding-query-parameters-to-url-using-google-apps-script/
   *
   * @param {String} url The base URL for adding the query parameters.
   * @param {Object} obj JSON object including query parameters.
   * @return {String} URL including the query parameters.
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