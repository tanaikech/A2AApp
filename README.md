# A2AApp

Enabling Collaborative Agent Systems through Google Apps Script-based Agent2Agent (A2A) Network

<a name="top"></a>
[![MIT License](http://img.shields.io/badge/license-MIT-blue.svg?style=flat)](LICENCE)

<a name="overview"></a>


![](images/fig1.jpg)

# Overview

This report details an Agent2Agent (A2A) network built with Google Apps Script. It enables secure, decentralized AI communication and integration within Google Workspace, acting as both an A2A server and client.

# Description

This report details the creation of an Agent2Agent (A2A) network utilizing Google Apps Script's Web Apps. A2A is an open protocol designed for secure and seamless communication between various AI agents, addressing limitations of isolated platforms.

The implementation leverages Google Apps Script to establish a decentralized and interoperable AI agent ecosystem, showcasing its practical application in building a robust and secure A2A network. It highlights the script's capabilities for internal or user-centric AI integrations within Google Workspace, providing secure access to Google services like Docs and Sheets for AI-powered workflows. A2AApp functions as both an A2A server and client, enabling secure AI agent communication and facilitating access to essential services, ultimately empowering more sophisticated and interconnected AI applications.

# Advantages of Using A2A Server and Client with Google Apps Script

Here are the advantages of using an A2A (Agent-to-Agent) server and client with Google Apps Script:

* **Integration with Google Workspace**: It allows direct management of active Google Docs and Sheets when using the A2A client.
* **Seamless Integration with Google Resources**: Effortlessly connects with Google services like Google APIs, Docs, Sheets, Slides, Gmail, and Calendar, leveraging secure authorization scopes.
* **Enhanced Security via Access Tokens**: Simplifies access token acquisition for Web Apps, eliminating the need for temporary token inclusion in Python client queries for agent card retrieval.
* **Improved User Restriction**: Web Apps can be restricted to specific users, increasing security.
* **Automated Script Execution**: Supports automatic script execution via triggers, beneficial for client-side operations. This client can interact with various A2A servers (Google Apps Script, Python, Node.js, etc.).
* **Easy Deployment**: Web Apps can be readily deployed as A2A servers, accessible by various A2A clients (Google Apps Script, Python, Node.js, etc.).
* **Decentralized Agent Communication**: Enables direct communication between AI agents, fostering a decentralized AI ecosystem.

# Repository

[https://github.com/tanaikech/A2AApp](https://github.com/tanaikech/A2AApp)

# Usage

Here, the following sample is used for testing.


![](images/fig2.jpg)

Please do the following steps.

## 1. Ger API key

In order to use the scripts in this report, please use your API key. [Ref](https://ai.google.dev/gemini-api/docs/api-key) This API key is used to access the Gemini API.

## 2. Copy sample files

**If you want to use A2AApp as a library, please check [this](https://github.com/tanaikech/A2AApp/tree/master/Use_A2AApp_as_library).**

Here, an A2A client and 4 A2A servers are used. Those files can be copied by the following simple Google Apps Script. Please copy and paste the following script to the script editor of Google Apps Script, and run `myFunction`. By this, the requirement files are copied to your Google Drive. The whole scripts can also be seen on [this repository](https://github.com/tanaikech/A2AApp).

When `dstFolder` is `root`, the files are copied to the root folder. If you want to copy them to the specific folder, please set your folder ID.

```javascript
function myFunction() {
  const dstFolderId = "root"; // Please set your destination folder ID. The default is the root folder.

  // These file IDs are the sample client and servers.
  const fileIds = [
    "1IcUv4yQtlzbiAqRXCEpIfilFRaY4_RS5idKEEdzNWgk", // A2A client,
    "103RvSs0xWgblNHqEssVMo-ar7Ae8Fe-NyUsyL1m4k0u428hB7v7Jmnby", // A2A server 1_Google Sheets Manager Agent
    "1z8bDFo8n4ssco8UeBXatLp3yMPUVkbqEofZE8y1-XYstEqYiGifvVSwf", // A2A server 2_Google Drive Manager Agent,
    "1FltchXoOfbo731KAWJd0hGbrN75aZ_lg76og-ooldk5B-uAE142RppWa", // A2A server 3_Google Calendar Manager Agent,
    "1k3-JwyKBJ2DsGeWeT0dTucdzm0DHSd_1XlaevFA4_pJhGL67vDRYD0ym", // A2A server 4_APIs Manager Agent,
  ];

  const folder = DriveApp.getFolderById(dstFolderId);
  const headers = { authorization: "Bearer " + ScriptApp.getOAuthToken(), "Content-Type": "application/json" };
  const reqs = fileIds.map(fileId => ({
    url: `https://www.googleapis.com/drive/v3/files/${fileId}/copy`,
    headers,
    payload: JSON.stringify({ parents: [dstFolderId], name: DriveApp.getFileById(fileId).getName() })
  }));
  UrlFetchApp.fetchAll(reqs).forEach(res => {
    const { id } = JSON.parse(res.getContentText());
    DriveApp.getFileById(id).moveTo(folder);
  });
  
  //  If an error is related to Drive API, please enable Drive API v3 at Advanced Google services.
}
```

When this function is run, the following files are copied.

- "A2A client"
- "A2A server 1_Google Sheets Manager Agent"
- "A2A server 2_Google Drive Manager Agent,"
- "A2A server 3_Google Calendar Manager Agent"
- "A2A server 4_APIs Manager Agent"


### Use A2AApp as a GAS library

If you want to use A2AApp as a GAS library, the library key is as follows.

```
1OuHIiA5Ge0MG_SpKdv1JLz8ZS3ouqhvrF5J6gRRr6xFiFPHxkRsgjMI6
```

## 2. Setting


### 1. A2A servers

For 4 A2A servers, please follow the following steps.

#### 1. Set API key

Open the script editors of "A2A server 1", "A2A server 2", "A2A server 3", and "A2A server 4". And, please set your API key for using the Gemini API to `apiKey` in `A2Aserver1.gs`, `A2Aserver2.gs`, `A2Aserver3.gs`, and `A2Aserver4.gs`.

#### 2. Deploy Web Apps

To allow access from the A2A client, the server side uses Web Apps built with Google Apps Script. [Ref](https://developers.google.com/apps-script/guides/web) The A2A client can access the A2A server using a GET and POST HTTP request. Thus, the Web Apps can be used as the A2A server.

Detailed information can be found in [the official documentation](https://developers.google.com/apps-script/guides/web#deploy_a_script_as_a_web_app).

Please follow these steps to deploy the Web App in the script editors for 4 A2A servers.

1. In the script editor, at the top right, click "Deploy" -> "New deployment".
2. Click "Select type" -> "Web App".
3. Enter the information about the Web App in the fields under "Deployment configuration".
4. Select **"Me"** for **"Execute as"**.
5. Select **"Anyone"** for **"Who has access to the app:"**. In this sample, a simple approach allows requests without an access token. However, a custom API key is used for accessing the Web App.
6. Click "Deploy".
7. On the script editor, at the top right, click "Deploy" -> "Test deployments".
8. Please run the function `getServerURL` with the script editor. By this, the URL like `
https://script.google.com/macros/s/###/dev?accessKey=sample` is retrieved. Please copy each Web Apps URL for 4 A2A servers.

**It is important to note that when you modify the Google Apps Script for the Web App, you must modify the deployment as a new version.** This ensures the modified script is reflected in the Web App. Please be careful about this. Also, you can find more details on this in my report "[Redeploying Web Apps without Changing URL of Web Apps for new IDE](https://gist.github.com/tanaikech/ebf92d8f427d02d53989d6c3464a9c43)".

In this sample, after the client with Google Apps Script was tested, the servers will be tested by a Python script. So, `Execute as: Me` and `Who has access to the app: Anyone` are used.

### 2. A2A client

For the A2A client, please follow the following steps.

#### 1. Set API key

Open the Google Spreadsheet of "A2A client", and open the script editor of Google Apps Script. And, please set your API key for using Gemini API to `apiKey` in `main.gs`.

#### 2. Set Web Apps URLs

Please set your Web Apps URLs for 4 A2A servers to `agentCardUrls`. And, save the script. In this sample, 4 Web Apps URLs are set.

## 3. Testing
Please reopen the Google Spreadsheet of the A2A client. By this, you can see the custom menu `Run`. Please run `Open sidebar`. When you see the authorization dialog open, please authorize all scopes. By this, the sidebar is opened. When the above steps were correctly done, you can test it. The demonstration of this is as follows.

### Sample 1
In the 1st sample, the active Spreadsheet is used.

![](images/fig3.gif)

First, the value of the active cell is retrieved.

Prompt: **Get the active cells. Return the values from the active cells.**
Response: **The active cell is B2 in Sheet1 of the spreadsheet with ID ###. The value of this cell is "sample text"**

Next, the values are put into the active cell.

Prompt: **Get the active cells. Put values '[["a1", "b1"],["a2", "b2"],["a3", "b3"]]' to the active cell.
Response: The active cell is A5 in Sheet1 of the spreadsheet with ID ###. The values '[[\"a1\", \"b1\"],[\"a2\", \"b2\"],[\"a3\", \"b3\"]]' have been successfully placed into cells A5:B7 of the same sheet and spreadsheet.**

The information of the active cell is retrieved on the A2A client, and the information is used in the A2A server (Google Sheets Manager Agent). This result indicates the advantage of using the A2A client built by Google Apps Script.

### Sample 2
In the 2nd sample, image data is retrieved from Google Drive.

![](images/fig4.gif)

Prompt: **Show the image of CherryBlossom from Google Drive.**
Response: **OK. I have downloaded the image \"CherryBlossom.png\" from Google Drive.**

### Sample 3
In the 3rd sample, multiple agents are used.

![](images/fig5.gif)

Prompt: **Check tomorrow's weather conditions at 12 PM around Shinagawa Station and exchange 100 US Dollars for Japanese Yen. Under this condition, will we enjoy eating lunch outside for 1 hour at the retrieved location and that day? Finally, create it as a schedule in Google Calendar.**

Response: **OK. Here's a summary based on your question and the provided answers: The weather in Shinagawa Station at 12 PM on May 28, 2025, is predicted to be mainly clear, partly cloudy, and overcast. The exchange rate is 100 USD to approximately 14,290 JPY. A Google Calendar event titled 'Lunch at Shinagawa Station' has been created for May 28, 2025, from 12:00 to 13:00, including the weather conditions and JPY value in the description. To determine if eating lunch outside for an hour is suitable, factors like temperature, wind, and personal preferences should be considered along with the mainly clear, partly cloudy, and overcast conditions.**

This process automatically creates an event in Google Calendar as follows.


![](images/fig6.png)

In this case, this response was created using "create_schedule_to_Google_Calendar" of "Google Calendar Manager Agent" and "get_exchange_rate" and "get_current_weather" of "APIs Manager Agent" together with the A2A client. Also, an event was automatically created in Google Calendar. From this result, you can confirm that AI agents are working together.

### Options
A2AApp has the following options.

- In the case of `Execute as: Me` and `Who has access to the app: Anyone` for Web Apps, anyone can access. To enhance security, an access key can be used. When using the access key, please set it as follows: `return new A2AApp({accessKey: "sample"}).server(object);`. Additionally, please add it as a query parameter to the Web App URL as follows: `https://script.google.com/macros/s/###/exec?accessKey=sample` and `https://script.google.com/macros/s/###/dev?access_token=###&accessKey=sample`.
- Also, in the case of the A2A client with Google Apps Script, it accesses the Web Apps of the A2A server with Google Apps Script using the access token. By this, even when "Who has access: Anyone with Google account" can be used as the setting. But, in that case, it is required to share the Google Apps Script projects. Please be careful about this.
- A2AApp can also record a log. In this case, please set it as follows: `return new A2AApp({accessKey: "sample", log: true, spreadsheetId: "###"}).server(object);`. With this setting, the log is recorded in the Spreadsheet.
- A2AApp server can also connect to other servers. For example, when an A2A server is connected to another server, please put the URLs of the servers in `agentCardUrls` of [A2A server 1_Google Sheets Manager Agent.js](https://github.com/tanaikech/A2AApp/blob/master/A2A%20server%201_Google%20Sheets%20Manager%20Agent.js). You can do this for the same for other servers. But, in the current stage, when Google Apps Script is used, I think that directly connecting an A2A client with multiple servers is better because of the process cost.

# Summary

The successful communication between the A2A client and A2A servers, both developed using Google Apps Script, demonstrates the viability of building such a system within the Google ecosystem. This setup leverages the power of active Google services like Google Sheets and Google Docs, enhancing their utility through the A2A client.

A key proposed enhancement for this system is the implementation of an exclusive server that would centralize and provide the URLs of all A2A servers to clients. This approach would enable more efficient management of A2A servers on a per-client basis. Furthermore, it suggests the potential for an A2A server designed to manage Gmail, facilitating automated tasks such as autoreplies and Google Calendar event creation by periodically reading incoming emails.

# Additional Information: Testing A2A Client with Python Using A2A Servers Built by Google Apps Script

The 4 A2A servers built by Google Apps Script, shown in the image above, can also be used with Google's Python demo UI, as shown in the following demo video. [Ref](https://github.com/google-a2a/)

![](images/fig7.gif)

The following sections explain how to test the demo UI from Google. [Ref](https://github.com/google-a2a/) If you wish to use it, please follow these steps. If you are not required to use this and are only testing the client with Google Apps Script, you may skip this section.

<details>

## 1. Prepare a demo for testing an A2A Protocol

The demo can be retrieved from [https://github.com/google-a2a/](https://github.com/google-a2a/).

To connect the client of this demo to the Web App created using Google Apps Script, several modifications are required as follows.

### 1-1. Add redirect

Accessing the Web App requires a redirect. However, currently, the demo script cannot handle redirects. Therefore, a modification is required. Please modify the `_send_request` function in `a2a-samples/samples/python/common/client/client.py` as follows. [Ref](https://github.com/google-a2a/a2a-samples/blob/main/samples/python/common/client/client.py#L71) This modification allows the client to access the Web App.

From

```python
response = await client.post(
    self.url, json=request.model_dump(), timeout=self.timeout
)
```

To

```python
response = await client.post(
    self.url, json=request.model_dump(), timeout=self.timeout, follow_redirects=True
)
```

### 1-2. Add query parameter

As mentioned in the next section, to directly access the Web App using the `.well-known/agent.json` path, an access token is required. In this case, the access token must be included as a query parameter. However, currently, the demo script cannot add the query parameter. Therefore, a modification is required. Please modify the `get_agent_card` function in `a2a-samples/demo/ui/utils/agent_card.py` as follows. [Ref](https://github.com/google-a2a/a2a-samples/blob/main/demo/ui/utils/agent_card.py) This modification ensures that when a URL like `https://script.google.com/macros/s/###/dev?access_token=###` is used to register the agent card, it is correctly converted to `https://script.google.com/macros/s/###/dev/.well-known/agent.json?access_token=###`. This allows the Web App to be accessed using the `.well-known/agent.json` path.

```python
import requests

from common.types import AgentCard
from urllib.parse import urlparse

def get_agent_card(remote_agent_address: str) -> AgentCard:
    """Get the agent card."""
    p = urlparse(remote_agent_address)
    url = f"{p.scheme}://{p.netloc}{p.path}/.well-known/agent.json?{p.query}"

    # agent_card = requests.get(f'http://{remote_agent_address}/.well-known/agent.json')
    agent_card = requests.get(url)

    return AgentCard(**agent_card.json())
```

This modification is not required if you are using a local server to register the Web App's agent card.

## 2. Register Agent Card

**This section is for the demo by Google. [Ref](https://github.com/google-a2a/) If you want to use this, please follow the following steps. If you are not required to use this and you test with only the client with Google Apps Script, please skip this section.**

To register the agent card on the client side, there are the following two patterns.

### Pattern 1

In this pattern, the agent card is registered directly from the A2A server to the A2A client. To achieve this, it is required to know the specifications of Web Apps in Google Apps Script. When the agent card is registered to the client side, it is required to access the path `https://{someURL}/.well-known/agent.json`. Unfortunately, at the current stage, Web Apps cannot be directly accessed with such a URL. However, when an access token is used, Web Apps can be accessed using such a URL. [Ref](https://github.com/tanaikech/taking-advantage-of-Web-Apps-with-google-apps-script?tab=readme-ov-file#pathinfo-updated-on-february-14-2023) The path `.well-known/agent.json` can be confirmed as `pathInfo` in the event object of Web Apps. This specification is used in this pattern.

To test this, the URL for registering the agent card is retrieved using the following script. This function is included in each server.

```javascript
/**
 * This function is used for retrieving the URL for registering the AgentCard to Python demo script.
 * Please directly run this function and copy the URL from the log.
 */
function getRegisteringAgentCardURL() {
  const registeringAgentCardURL = `${ScriptApp.getService().getUrl()}?access_token=${ScriptApp.getOAuthToken()}&accessKey=sample`;
  console.log(registeringAgentCardURL);
}
```

At the current stage, the expiration time of the access token is 1 hour. However, it is considered that this will be sufficient for testing this sample. If you want to permanently use the server built with Web Apps created by Google Apps Script, the next pattern 2 might be useful.

### Pattern 2

In this pattern, the agent card is registered to the A2A client using a local server. The sample script is as follows.

Please set your Web Apps URL to `WebApps_URL = "https://script.google.com/macros/s/###/exec"`. If you want to use an access key, please add it like `https://script.google.com/macros/s/###/exec?accessKey=sample`.

**IMPORTANT: In this case, `/dev` is not used. It's required to be `/exec` because the access token is not used.. Please be careful about this.**

When you add the agent card for the A2A server with Web Apps, it can be achieved by putting the Web Apps URL into `url` in the agent card. In this case, the access token is not required because Web Apps is not accessed via the `.well-known/agent.json` path. You can register the agent card using this server. In this pattern, the A2A server created by Web Apps can be used permanently.

```python
import logging
import click

from common.server import A2AServer
from common.types import (
    AgentCapabilities,
    AgentCard,
    AgentSkill,
)


WebApps_URL = "https://script.google.com/macros/s/###/exec"

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)


@click.command()
@click.option('--host', 'host', default='localhost')
@click.option('--port', 'port', default=10001)
def main(host, port):
    """Starts the Sample Agent server."""

    capabilities = AgentCapabilities(streaming=False, pushNotifications=False)
    skill = AgentSkill(
        id="###",
        name="###",
        description="###",
        tags=["###"],
        examples=["###"],
    )
    agent_card = AgentCard(
        name="###",
        description="###",
        url=WebApps_URL,
        version='1.0.0',
        defaultInputModes=['text', 'text/plain'],
        defaultOutputModes=['text', 'text/plain'],
        capabilities=capabilities,
        skills=[skill],
    )

    server = A2AServer(
        agent_card=agent_card,
        task_manager={},
        host=host,
        port=port,
    )

    logger.info(f'Starting server on {host}:{port}')
    server.start()


if __name__ == '__main__':
    main()
```

## 3. Testing for Python client of demo of Google

To test this, complete the following steps:

- The A2A server for the Web Apps has already been deployed.
- The demo script at [https://github.com/google-a2a/](https://github.com/google-a2a/) has already been modified to access the Google Apps Script web app.
- The demo script has already been run.

Once the above steps are completed, access `http://0.0.0.0:12000/` or `http://localhost:12000` in your browser. And, install the agent cards. This will display the UI like the above demonstration.

</details>

---

<a name="licence"></a>

# Licence

[MIT](LICENCE)

<a name="author"></a>

# Author

[Tanaike](https://tanaikech.github.io/about/)

[Donate](https://tanaikech.github.io/donate/)

<a name="updatehistory"></a>

# Update History

- v1.0.0 (May 16, 2025)

  1. Initial release.

- v2.0.0 (May 28, 2025)

  1. Updated A2A server.
  2. Added A2A client.

- v2.0.1 (May 29, 2025)

  1. From v2.0.1, A2AApp can also be used as a library. [Ref](https://github.com/tanaikech/A2AApp/tree/master/Use_A2AApp_as_library)

- v2.0.2 (June 18, 2025)

  1. A bug was removed.

- v2.0.3 (June 19, 2025)

  1. A bug was removed.

- v2.0.4 (December 17, 2025)

  1. Updated A2AApp for A2A Protocol v0.3.0.

[TOP](#top)

