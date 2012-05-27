/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");

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

  showGraphUI: function GUI_showGraphUI() {
    GraphUI._window = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    GraphUI._console = Cc["@mozilla.org/consoleservice;1"]
                         .getService(Ci.nsIConsoleService);
    GraphUI.addRemoteListener(GraphUI._window);
    GraphUI.sendMessage(UIEventMessageType.INIT_DATA_SINK);
    GraphUI.UIOpened = true;
  },

  readData: function GUI_readData() {
    DataStore.getRangeById(GraphUI.processData, GraphUI._currentId);
  },

  processData: function GUI_processData(aData) {
    GraphUI._currentId += aData.length;
    // dumping to console for now.
    for (let i = 0; i < aData.length; i++) {
      GraphUI._console
             .logStringMessage("ID: " + aData[i].id +
                               "; Producer: " + aData[i].producer +
                               "; Name: " + aData[i].name +
                               "; Time: " + aData[i].time +
                               "; Type: " + aData[i].type + "; Datails: url - " +
                               aData[i].details.log.entries[0].request.url + " " +
                               aData[i].details.log.entries[0].request.method + ";");
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
        GraphUI.readData();
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

  hideGraphUI: function GUI_hideGraphUI() {
    if (GraphUI.UIOpened == true) {
      Services.prompt.confirm(null, "", "GraphUI: Hiding UI");
      GraphUI.sendMessage(UIEventMessageType.DESTROY_DATA_SINK);
      GraphUI.removeRemoteListener(GraphUI._window);
      GraphUI.UIOpened = GraphUI._currentId = GraphUI._window = null;
    }
  }
};
