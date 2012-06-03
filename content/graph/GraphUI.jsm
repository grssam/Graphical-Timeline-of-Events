/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["GraphUI"];

/**
 * List of message types that the UI can send.
 */
const UIEventMessageType = {
  INIT_DATA_SINK: 0, // Initialize the Data Sink and start all the producers.
  DESTROY_DATA_SINK: 1, // Destroy the Data Sink and stop all producer activity.
  START_PRODUCER: 2, // To start a single producer.
  STOP_PRODUCER: 3, // To stop a single producer.
  ADD_WINDOW: 4, // Add another window to listen for tab based events.
  REMOVE_WINDOW: 5, // Stop listening for events for tab based events.
};

/**
 * List of message types that the UI can listen for.
 */
const DataSinkEventMessageType = {
  NEW_DATA: 0, // There is new data in the data store.
};

/**
 * The Graph User Interface
 */
let GraphUI = {

  _currentId: 1,
  _window: null,
  _console: null,

  UIOpened: false,
  newDataAvailable: false,
  readingData: false,
  databaseName: "",

  timer: null,

  /**
   * Displays the UI for the Graphical Timeline and sends message to start
   * the Data Sink.
   */
  showGraphUI: function GUI_showGraphUI() {
    GraphUI._window = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    GraphUI._console = Cc["@mozilla.org/consoleservice;1"]
                         .getService(Ci.nsIConsoleService);
    GraphUI.addRemoteListener(GraphUI._window);
    GraphUI.timer = GraphUI._window.setInterval(GraphUI.readData, 100);
    // Importing the Data Store and making a database
    Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
    GraphUI.databaseName = "timeline-database-" + (new Date()).getTime();
    GraphUI.dataStore = new DataStore(GraphUI.databaseName);
    GraphUI.sendMessage(UIEventMessageType.INIT_DATA_SINK,
                        {databaseName: GraphUI.databaseName});
    GraphUI.UIOpened = true;
  },

  /**
   * Check for any pending data to read and sends a request to Data Store.
   */
  readData: function GUI_readData() {
    if (GraphUI.newDataAvailable && !GraphUI.readingData) {
      GraphUI.readingData = true;
      GraphUI.dataStore.getRangeById(GraphUI.processData, GraphUI._currentId);
    }
  },

  /**
   * Processes the data received from Data Store
   *
   * @param array aData
   *        Array of normalized data received from Data Store.
   */
  processData: function GUI_processData(aData) {
    GraphUI.readingData = GraphUI.newDataAvailable = false;
    GraphUI._currentId += aData.length;
    // dumping to console for now.
    for (let i = 0; i < aData.length; i++) {
      GraphUI._console
             .logStringMessage("ID: " + aData[i].id +
                               "; Producer: " + aData[i].producer +
                               "; Name: " + aData[i].name +
                               "; Time: " + aData[i].time +
                               "; Type: " + aData[i].type + "; Datails: " +
                               (aData[i].producer == "NetworkProducer"? "url - " +
                                aData[i].details.log.entries[0].request.url + " " +
                                aData[i].details.log.entries[0].request.method + ";"
                                : JSON.stringify(aData[i].details)));
    }
  },

  /**
   * Listener for events coming from remote Data Sink.
   *
   * @param object aEvent
   *        Data object associated with the incoming event.
   */
  _remoteListener: function GUI_remoteListener(aEvent) {
    let message = aEvent.detail.messageData;
    let type = aEvent.detail.messageType;
    switch(type) {
      case DataSinkEventMessageType.NEW_DATA:
        GraphUI.newDataAvailable = true;
        break;
    }
  },

  /**
   * Listen for starting and stopping instructions to enable remote startup
   * and shutdown.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window to apply the event listener.
   */
  addRemoteListener: function GUI_addRemoteListener(aChromeWindow) {
    aChromeWindow.addEventListener("GraphicalTimeline:DataSinkEvent",
                                   GraphUI._remoteListener, true);
  },

  /**
   * Removes the remote event listener from a window.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window from which listener is to be removed.
   */
  removeRemoteListener: function GUI_removeRemoteListener(aChromeWindow) {
    aChromeWindow.removeEventListener("GraphicalTimeline:DataSinkEvent",
                                      GraphUI._remoteListener, true);
  },

  /**
   * Fires an event to start or stop the the Data Sink.
   *
   * @param int aMessageType
   *        One of DataSinkEventMessageType
   * @param object aMessageData
   *        Data concerned with the event.
   */
  sendMessage: function GUI_sendMessage(aMessageType, aMessageData) {
    let detail = {
                   "detail":
                     {
                       "messageData": aMessageData,
                       "messageType": aMessageType,
                     },
                 };
    let customEvent =
      new GraphUI._window.CustomEvent("GraphicalTimeline:UIEvent", detail)
    GraphUI._window.dispatchEvent(customEvent);
  },

  /**
   * Hides the UI and stops all the activity of Data Sink.
   */
  hideGraphUI: function GUI_hideGraphUI() {
    if (GraphUI.UIOpened == true) {
      GraphUI._window.clearInterval(GraphUI.timer);
      GraphUI.dataStore.destroy();
      try {
        Cu.unload("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
      } catch (ex) {}
      GraphUI.removeRemoteListener(GraphUI._window);
      GraphUI.sendMessage(UIEventMessageType.DESTROY_DATA_SINK,
                          {deleteDatabase: true}); // true to delete the database
      GraphUI.newDataAvailable = GraphUI.UIOpened = GraphUI.timer = DataStore =
        GraphUI.dataStore = GraphUI._currentId = GraphUI._window = null;
    }
  }
};
