/**
 * GitHub  https://github.com/tanaikech/A2AApp<br>
 * Library name
 * @type {string}
 * @const {string}
 * @readonly
 */
var appName = "A2AApp";

/**
 * Main Class
 * 
 * @param {Object} object Object using this script.
 * @param {Boolean} object.log Default is false. When this is true, the log between A2A is stored to Google Sheets.
 * @param {String} object.spreadsheetId Spreadsheet ID. Log is stored to "Log" sheet of this spreadsheet.
 * @returns {A2AApp}
 */
function a2aApp(object) {
  this.a2aApp = new A2AApp(object);
  return this.a2aApp;
}

/**
* ### Description
* Set services depend on each script. For example, those are LockService and PropertiesService.
* For example, if you don't set these properties, you cannot use this as a library.
* If you want to use A2AApp as a library, please set the services.
*
* @param {Object} services Array including the services you want to use.
* @param {GoogleAppsScript.Lock.Lock} services.lock Lock service instance.
* @param {GoogleAppsScript.Properties.Properties} services.properties Properties service instance.
* @return {A2AApp}
*/
function setServices(services) {
  if (!this.a2aApp) {
    this.a2aApp = new A2AApp();
  }
  return this.a2aApp.setServices(services);
}

/**
 * ### Description
 * Method for the A2A server.
 *
 * @param {Object} object Object using this script.
 * @param {Object} object.eventObject Event object from doPost and doGet functions.
 * @param {Object} object.apiKey API key for using Gemini API.
 * @param {Function} object.agentCard Getter function for agent card object.
 * @param {Function} object.functions Getter function for functions object.
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function server(object) {
  if (!this.a2aApp) {
    throw new Error("Please initialize A2AApp with a2aApp() before using server().");
  }
  return this.a2aApp.server(object);
}

/**
 * ### Description
 * Method for the A2A client.
 *
 * @param {Object} object Parameters object.
 * @return {Object} Result object including result, history, and agentCards.
 */
function client(object) {
  if (!this.a2aApp) {
    throw new Error("Please initialize A2AApp with a2aApp() before using client().");
  }
  return this.a2aApp.client(object);
}

/**
 * ### Description
 * Sets the conversation history for the agent.
 *
 * @param {Array<Object>} history An array of history objects containing 'role' and 'parts'.
 * @return {A2AApp}
 */
function setHistory(history) {
  if (!this.a2aApp) {
    this.a2aApp = new A2AApp();
  }
  return this.a2aApp.setHistory(history);
}

/**
 * ### Description
 * Retrieves the current conversation history.
 *
 * @return {Array<Object>} The current history array.
 */
function getHistory() {
  if (!this.a2aApp) {
    this.a2aApp = new A2AApp();
  }
  return this.a2aApp.getHistory();
}

/**
 * ### Description
 * Retrieve and parse agent cards from given URLs.
 *
 * @param {Array<String|Object>} agentCardUrls Array of strings or objects referring to remote card sources.
 * @return {Array<Object>} Array of sanitized agent card objects.
 */
function getAgentCards(agentCardUrls) {
  if (!this.a2aApp) {
    this.a2aApp = new A2AApp();
  }
  return this.a2aApp.getAgentCards(agentCardUrls);
}

/**
 * ### Description
 * Return HtmlService.HtmlOutput for UI of A2A client.
 *
 * @return {HtmlService.HtmlOutput}
 */
function getClientIndex() {
  return HtmlService.createHtmlOutputFromFile("index_client").setTitle("A2A client from A2AApp");
}
