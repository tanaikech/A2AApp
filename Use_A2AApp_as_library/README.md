# Use A2AApp as a Library

To build an A2A network, you'll need to create several clients and servers. Using A2AApp as a library can significantly streamline this process. This section explains how to use A2AApp as a library.

---

🚀 **A2AApp is officially integrated with [GASADK (adk-gas)](https://github.com/tanaikech/adk-gas)!**  
GASADK (Google Apps Script Agent Development Kit) allows you to build, manage, and connect various AI Agents under the A2A protocol effortlessly. Using A2AApp alongside GASADK empowers your agents to communicate, collaborate, and execute complex workflows seamlessly.

---

### Library Project Key

```
1OuHIiA5Ge0MG_SpKdv1JLz8ZS3ouqhvrF5J6gRRr6xFiFPHxkRsgjMI6
```

---

## Usage

To use A2AApp as a library, follow these installation steps:

### 1. Create a GAS Project

You can use this library with both standalone and container-bound Google Apps Script (GAS) projects.

### 2. Install the Library

Follow the instructions [here to install this library](https://developers.google.com/apps-script/guides/libraries). The library's project key is **`1OuHIiA5Ge0MG_SpKdv1JLz8ZS3ouqhvrF5J6gRRr6xFiFPHxkRsgjMI6`**.

### 3. Prepare Your Script

When using A2AApp as a library, you'll need to modify your script as shown below. You don't need to copy and paste `A2AApp.gs` and `GeminiWithFiles.gs` because they are included in the library.

#### For Clients

Modify [A2AClient.js](https://github.com/tanaikech/A2AApp/blob/master/A2AClient.js) as follows:

**From:**

```javascript
const obj = new A2AApp().client(object);
```

**To:**

```javascript
const obj = new A2AApp.a2aApp().setServices({ lock: LockService.getScriptLock() }).client(object);
```

#### For Servers

Modify [A2A server 1_Google Sheets Manager Agent.js](https://github.com/tanaikech/A2AApp/blob/master/A2A%20server%201_Google%20Sheets%20Manager%20Agent.js) as follows. Apply the same change to other servers.

**From:**

```javascript
const res = new A2AApp({ accessKey: "sample" }).server(object);
```

**To:**

```javascript
const res = new A2AApp.a2aApp({ accessKey: "sample" }).setServices({ lock: LockService.getScriptLock() }).server(object);
```

---

## Global Functions Exposed by the Library

When using A2AApp as a library (using the library name `A2AApp`), the following global functions are exposed and can be used to control the internal `A2AApp` instance.

### `a2aApp(object)`
Initializes and returns the `A2AApp` instance.
- `object`: Configuration object passed to the `A2AApp` constructor.

### `setServices(services)`
Sets script lock and properties services.
- `services.lock` (Lock): Script lock instance.
- `services.properties` (Properties): Script properties instance.

### `server(object)`
Handles A2A server-side requests.
- `object`: Parameters including `eventObject`, `apiKey`, `agentCard`, and `functions`.

### `client(object)`
Runs A2A client orchestration.
- `object`: Parameters including `apiKey`, `prompt`, `agentCardUrls`, and optionally `directRouting`.

### `setHistory(history)`
Sets the conversation history state.
- `history`: Array of chat history blocks.

### `getHistory()`
Retrieves the current conversation history.

### `getAgentCards(agentCardUrls)`
Retrieves and parses agent cards from target URLs.

### `getClientIndex()`
Returns a pre-built `HtmlOutput` for the client UI.
