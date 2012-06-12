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
  PING_HELLO: 0, // Tells the remote Data Sink that a UI has been established.
  INIT_DATA_SINK: 1, // Initialize the Data Sink and start all the producers.
  DESTROY_DATA_SINK: 2, // Destroy the Data Sink and stop all producer activity.
  START_PRODUCER: 3, // To start a single producer.
  STOP_PRODUCER: 4, // To stop a single producer.
  ADD_WINDOW: 5, // Add another window to listen for tab based events.
  REMOVE_WINDOW: 6, // Stop listening for events for tab based events.
};

/**
 * List of message types that the UI can listen for.
 */
const DataSinkEventMessageType = {
  PING_BACK: 0, // A reply from the remote Data Sink when the UI sends PING_HELLO.
                // Only upon receiving this message, the UI can send a message
                // to start the producers.
  NEW_DATA: 1,  // There is new data in the data store.
  UPDATE_UI: 2, // This event will be sent when there are local changes in
                // active features or producers and those changes need to be
                // reflected back to the UI.
};

const ERRORS = {
  ID_TAKEN: 0, // Id is already used by another timeline UI.
};

/**
 * The controller of the Timeline UI.
 *
 * @param chromeWindow aChromeWindow
 *        The window in which the UI should be setup and monitored.
 */
function TimelineView(aChromeWindow) {
  this._window = aChromeWindow;
  let gBrowser = this._window.gBrowser;
  let ownerDocument = gBrowser.parentNode.ownerDocument;

  this._splitter = ownerDocument.createElement("splitter");
  this._splitter.setAttribute("class", "devtools-horizontal-splitter");

  this.loaded = false;
  this.recording = false;
  this.producersPaneOpened = false;

  this._frame = ownerDocument.createElement("iframe");
  this._frame.height = TimelinePreferences.height;
  this._nbox = gBrowser.getNotificationBox(gBrowser.selectedTab.linkedBrowser);
  this._nbox.appendChild(this._splitter);
  this._nbox.appendChild(this._frame);

  this.createProducersPane = this.createProducersPane.bind(this);
  this.toggleProducersPane = this.toggleProducersPane.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.toggleFeature = this.toggleFeature.bind(this);
  this.toggleProducer = this.toggleProducer.bind(this);
  this.closeUI = this.closeUI.bind(this);
  this.$ = this.$.bind(this);
  this._showProducersPane = this._showProducersPane.bind(this);
  this._hideProducersPane = this._hideProducersPane.bind(this);
  this._onLoad = this._onLoad.bind(this);
  this._onUnload = this._onUnload.bind(this);

  this._frame.addEventListener("load", this._onLoad, true);
  this._frame.setAttribute("src", "chrome://graphical-timeline/content/graph/timeline.xul");
}

TimelineView.prototype = {

  /**
   * Attaches various events and sets references to the different parts of the UI.
   */
  _onLoad: function NV__onLoad()
  {
    this.loaded = true;
    this._frame.removeEventListener("load", this._onLoad, true);
    this._frameDoc = this._frame.contentDocument;
    this.closeButton = this.$("close");
    this.recordButton = this.$("record");
    this.producersButton = this.$("producers");
    this.producersPane = this.$("producers-pane");
    // Attaching events.
    this.closeButton.addEventListener("command", GraphUI.destroy, true);
    this.recordButton.addEventListener("command", this.toggleRecording, true);
    this.producersButton.addEventListener("command", this.toggleProducersPane, true);
    this._frame.addEventListener("unload", this._onUnload, true);
    // Building the UI according to the preferences.
    if (TimelinePreferences.visiblePanes.indexOf("producer") == -1) {
      this.producersPane.collapsed = true;
      this.producersButton.checked = false;
    }
    else {
      this.producersPane.collapsed = false;
      this.producersButton.checked = true;
    }
  },

  /**
   * Updates the UI with the given list of active features and producers.
   * Also changes the preferences accordingly.
   *
   * @param aMessage
   *        @see DataSink.init()
   */
  updateUI: function NV_updateUI(aMessage)
  {
    let enabledProducers = [];
    let enabledFeatures = [];
    let producerBoxes = this._frameDoc.getElementByClassName("producer-box");
    for each (let producerBox in producerBoxes) {
      let id = producerBox.getAttribute("producerId");
      if (aMessage.enabledProducers[id]) {
        enabledProducers.push(id);
        producerBox.setAttribute("enabled", true);
        let feature = producerBox.firstChild.nextSibling.firstChild;
        while (feature) {
          if (aMessage.enabledProducers[id].features
                      .indexOf(feature.getAttribute("label")) == -1) {
            try {
              feature.removeAttribute("checked");
            } catch (ex) {}
          }
          else {
            enabledFeatures.push(id + ":" + feature.getAttribute("label"));
            feature.setAttribute("checked", true);
          }
          feature = feature.nextSibling;
        }
      }
      else {
        producerBox.setAttribute("enabled", false);
      }
    }
    // Updating the prefenreces.
    TimelinePreferences.enabledFeatures = enabledFeatures;
    TimelinePreferences.enabledProducers= enabledProducers;
  },

  /**
   * Creates the Producers Pane based on the information provided.
   *
   * @param object aProducerInfoList
   *        List of information for each of the registered producer.
   *        Information includes:
   *        - id - The id of the producers.
   *        - name - The name of the producer to be displayed.
   *        - features - The features of the producer that can be toggled.
   *        - type - The type of the events that producer will send.
   */
  createProducersPane: function NV_createProducersPane(aProducerInfoList)
  {
    if (!this.loaded) {
      this._frame.addEventListener("load", function nvCreatePane() {
        this._frame.removeEventListener("load", nvCreatePane, true);
        this.createProducersPane(aProducerInfoList);
      }.bind(this), true);
      return;
    }
    this.producerInfoList = aProducerInfoList;

    // Iterating over each producer and adding a vbox containing producer name
    // and its features.
    for each (let producer in this.producerInfoList) {
      // The outer box for each producer.
      let producerBox = this._frameDoc.createElement("vbox");
      producerBox.setAttribute("id", producer.id + "-box");
      producerBox.setAttribute("class", "producer-box");
      producerBox.setAttribute("producerId", producer.id);

      if (TimelinePreferences.visibleProducers.indexOf(producer.id) == -1) {
        producerBox.setAttribute("visible", false);
      }
      else {
        producerBox.setAttribute("visible", true);
      }

      if (TimelinePreferences.activeProducers.indexOf(producer.id) == -1) {
        producerBox.setAttribute("enabled", false);
      }
      else {
        producerBox.setAttribute("enabled", true);
      }

      // The heading containing the name of the producer, icon to collapse/show
      // producer features and a button to enable the producer.
      let nameBox = this._frameDoc.createElement("hbox");
      nameBox.setAttribute("class", "producer-name-box");
      nameBox.setAttribute("producerId", producer.id);
      let nameLabel = this._frameDoc.createElement("label");
      nameLabel.setAttribute("class", "producer-name-label");
      nameLabel.setAttribute("value", producer.name);
      nameBox.appendChild(nameLabel);
      let spacer = this._frameDoc.createElement("spacer");
      spacer.setAttribute("flex", "1");
      nameBox.appendChild(spacer);
      let enableButton = this._frameDoc.createElement("toolbarbutton");
      enableButton.setAttribute("class", "producer-resume-button");
      enableButton.setAttribute("type", "checkbox");
      enableButton.addEventListener("command", this.toggleProducer, true);
      nameBox.appendChild(enableButton);
      let collapseButton = this._frameDoc.createElement("toolbarbutton");
      collapseButton.setAttribute("class", "producer-collapse-button");
      nameBox.appendChild(collapseButton);
      producerBox.appendChild(nameBox);

      // The features box contains list of each feature and a checkbox to toggle
      // that feature.
      let featureBox = this._frameDoc.createElement("vbox");
      featureBox.setAttribute("class", "producer-feature-box");
      featureBox.setAttribute("producerId", producer.id);
      for each (let feature in producer.features) {
        let featureCheckbox = this._frameDoc.createElement("checkbox");
        featureCheckbox.setAttribute("flex", "1");
        featureCheckbox.setAttribute("label", feature);
        featureCheckbox.addEventListener("command", this.toggleFeature, true);
        if (TimelinePreferences.activeFeatures
                               .indexOf(producer.id + ":" + feature) == -1) {
          try {
            featureCheckbox.removeAttribute("checked");
          }
          catch (e) {}
        }
        else {
          featureCheckbox.setAttribute("checked", true);
        }
        featureBox.appendChild(featureCheckbox);
      }
      producerBox.appendChild(featureBox);

      this.producersPane.appendChild(producerBox);
    }
  },

  /**
   * Toggles the Producers Pane.
   */
  toggleProducersPane: function NV_toggleProducersPane()
  {
    if (!this.loaded) {
      return;
    }
    if (this.producersPaneOpened) {
      this._hideProducersPane();
    }
    else {
     this._showProducersPane();
    }
  },

  _showProducersPane: function NV__showProducersPane()
  {
    this.producersPaneOpened = true;
    this.producersPane.collapsed = false;
  },

  _hideProducersPane: function NV__hideProducersPane()
  {
    this.producersPaneOpened = false;
    this.producersPane.collapsed = true;
  },

  /**
   * Starts and stops the listening of Data.
   */
  toggleRecording: function NV_toggleRecording()
  {
    if (!this.recording) {
      GraphUI.startListening();
    }
    else {
      GraphUI.stopListening();
    }
    this.recording = !this.recording;
  },

  /**
   * Toggles the feature.
   *
   * @param object aEvent
   *        Associated event for the command event call.
   */
  toggleFeature: function NV_toggleFeature(aEvent)
  {
    if (!this.recording) {
      return;
    }
    let target = aEvent.target;
    let linkedProducerId = target.parentNode.getAttribute("producerId");
    let feature = target.getAttribute("label");
    if (target.hasAttribute("checked")) {
      GraphUI.enableFeature(linkedProducerId, feature);
    }
    else {
      GraphUI.disableFeature(linkedProducerId, feature);
    }
  },

  /**
   * Toggles the producer.
   *
   * @param object aEvent
   *        Associated event for the command event call.
   */
  toggleProducer: function NV_toggleProducer(aEvent)
  {
    let target = aEvent.target;
    if (target.hasAttribute("checked")) {
      target.parentNode.parentNode.setAttribute("enabled", true);
    }
    else {
      target.parentNode.parentNode.setAttribute("enabled", false);
    }
    if (!this.recording) {
      return;
    }
    let producerId = target.parentNode.getAttribute("producerId");
    if (target.hasAttribute("checked")) {
      let features = [];
      let featureBox = target.parentNode.parentNode.lastChild;
      let checkbox = featureBox.firstChild;
      while (checkbox) {
        if (checkbox.hasAttribute("checked")) {
          features.push(checkbox.getAttribute("label"));
        }
        checkbox = checkbox.nextSibling;
      }
      GraphUI.startProducer(producerId, features);
    }
    else {
      GraphUI.stopProducer(producerId);
    }
  },

  /**
   * Closes the UI, removes the frame and the splitter ans dispatches an
   * unloading event to tell the parent window.
   */
  closeUI: function NV_closeUI() {
    if (!this.loaded) {
      return;
    }

    // Updating the preferences.
    TimelinePreferences.height = this._frame.height;
    if (this.producersPane.collapsed == false) {
      TimelinePreferences.visiblePanes = ["producer"];
    }
    else {
      TimelinePreferences.visiblePanes = [];
    }
    // let producerBoxes = this._frameDoc.getElementsByClassName("producer-box");
    // let visibleProducers = [];
    // for each (let producerBox in producerBoxes) {
      // if (producerBox.getAttribute("visible") == true) {
        // visibleProducers.push(producerBox.getAttribute("producerId"));
      // }
    // }
    // TimelinePreferences.visibleProducers = visibleProducers;

    // Removing frame and splitter.
    this._splitter.parentNode.removeChild(this._splitter);
    this._frame.parentNode.removeChild(this._frame);
  },

  _onUnload: function NV__onUnload()
  {
    this._frame = null;
    this._frameDoc = null;
    this._splitter = null;
    this._window = null;
    this.loaded = false;
  },

  /**
   * Equivalent function to this._framDoc.getElementById(ID)
   */
  $: function NV_$(ID) {
    return this._frameDoc.getElementById(ID);
  },
};

/**
 * The Timeline User Interface
 */
let GraphUI = {

  _currentId: 1,
  _window: null,
  _console: null,

  UIOpened: false,
  listening: false,
  pingSent: false,
  newDataAvailable: false,
  readingData: false,
  databaseName: "",
  producerInfoList: null,
  id: null,
  timer: null,

  /**
   * Prepares the UI and sends ping to the Data Sink.
   */
  init: function GUI_init() {
    GraphUI._window = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    GraphUI._console = Cc["@mozilla.org/consoleservice;1"]
                         .getService(Ci.nsIConsoleService);
    GraphUI.addRemoteListener(GraphUI._window);
    if (!GraphUI.id) {
      GraphUI.id = "timeline-ui-" + (new Date()).getTime();
    }
    GraphUI.pingSent = true;
    GraphUI.sendMessage(UIEventMessageType.PING_HELLO,
                        {timelineUIId: GraphUI.id});
  },

  /**
   * Builds the UI in the Tab.
   */
  buildUI: function GUI_buildUI() {
    GraphUI._view = new TimelineView(GraphUI._window);
    GraphUI._view.createProducersPane(GraphUI.producerInfoList);
    GraphUI.UIOpened = true;
  },

  /**
   * Starts the Data Sink and all the producers.
   */
  startListening: function GUI_startListening() {
    GraphUI.timer = GraphUI._window.setInterval(GraphUI.readData, 100);
    // Importing the Data Store and making a database
    Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
    GraphUI.dataStore = new DataStore(GraphUI.databaseName);
    GraphUI.sendMessage(UIEventMessageType.INIT_DATA_SINK,
                        {timelineUIId: GraphUI.id});
    GraphUI.listening = true;
  },

  /**
   * Stops the Data Sink and all the producers.
   */
  stopListening: function GUI_stopListening() {
    if (!GraphUI.listening) {
      return;
    }
    GraphUI._window.clearInterval(GraphUI.timer);
    GraphUI.timer = null;
    GraphUI.dataStore.destroy();
    try {
      Cu.unload("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
    } catch (ex) {}
    DataStore = GraphUI.dataStore = null;
    GraphUI.sendMessage(UIEventMessageType.DESTROY_DATA_SINK,
                        {deleteDatabase: true, // true to delete the database
                         timelineUIId: GraphUI.id, // to tell which UI is closing.
                        });
    GraphUI.listening = false;
  },

  /**
   * Handles the ping response from the Data Sink.
   *
   * @param object aMessage
   *        Ping response message containing either the databse name on success
   *        or the error on failure.
   */
  handlePingReply: function GUI_handlePingReply(aMessage) {
    if (!aMessage || aMessage.timelineUIId != GraphUI.id || !GraphUI.pingSent) {
      return;
    }
    if (aMessage.error) {
      switch (aMessage.error) {

        case ERRORS.ID_TAKEN:
          // The id was already taken, generate a new id and send the ping again.
          GraphUI.id = "timeline-ui-" + (new Date()).getTime();
          GraphUI.sendMessage(UIEventMessageType.PING_HELLO,
                              {timelineUIId: GraphUI.id});
          break;
      }
    }
    else {
      GraphUI.databaseName = aMessage.databaseName;
      GraphUI.producerInfoList = aMessage.producerInfoList;
      GraphUI.buildUI();
    }
  },

  /**
   * Tells the Data Sink to start a producer with the given features.
   *
   * @param string aProducerId
   *        Id of the producer to start.
   * @param array aFeatures
   *        List of features that should be enabled.
   */
  startProducer: function GUI_startProducer(aProducerId, aFeatures)
  {
    let message = {
      timelineUIId: GraphUI.timelineUIId,
      producerId: aProducerId,
      features: aFeatures,
    };
    GraphUI.sendMessage(UIEventMessageType.START_PRODUCER, message);
  },

  /**
   * Tells the Data Sink to stop the given producer.
   *
   * @param string aProducerId
   *        Id of the producer to stop.
   */
  stopProducer: function GUI_stopProducer(aProducerId, aFeatures)
  {
    let message = {
      timelineUIId: GraphUI.timelineUIId,
      producerId: aProducerId,
    };
    GraphUI.sendMessage(UIEventMessageType.STOP_PRODUCER, message);
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

      case DataSinkEventMessageType.PING_BACK:
        GraphUI.handlePingReply(message);
        break;

      case DataSinkEventMessageType.NEW_DATA:
        GraphUI.newDataAvailable = true;
        break;

      case DataSinkEventMessageType.UPDATE_UI:
        if (message.timelineUIId != GraphUI.timelineUIId) {
          GraphUI._view.updateUI(message);
        }
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
   * Stops the UI, Data Sink and Data Store.
   */
  destroy: function GUI_destroy() {
    if (GraphUI.UIOpened == true) {
      GraphUI.stopListening();
      GraphUI.removeRemoteListener(GraphUI._window);
      GraphUI._view.closeUI();
      GraphUI.newDataAvailable = GraphUI.UIOpened = GraphUI.timer =
        GraphUI._currentId = GraphUI._window = null;
      GraphUI.pingSent = false;
      GraphUI.producerInfoList = null;
    }
  }
};

/**
 * Various timeline preferences.
 */
let TimelinePreferences = {

  /**
   * Gets the preferred height of the timeline UI.
   * @return number
   */
  get height() {
    if (this._height === undefined) {
      this._height = Services.prefs.getCharPref("devtools.timeline.height");
    }
    return this._height;
  },

  /**
   * Sets the preferred height of the timeline UI.
   * @param number value
   */
  set height(value) {
    Services.prefs.setCharPref("devtools.timeline.height", value);
    this._height = value;
  },

  /**
   * Gets all the active features from last session.
   * Features are in the form of ProducerID:FeatureID.
   */
  get activeFeatures() {
    if (this._activeFeatures === undefined) {
      this._activeFeatures = JSON.parse(
        Services.prefs.getCharPref("devtools.timeline.activeFeatures"));
    }
    return this._activeFeatures;
  },

  /**
   * Sets the preferred active features.
   * @param array featureList
   */
  set activeFeatures(featureList) {
    Services.prefs.setCharPref("devtools.timeline.activeFeatures",
                               JSON.stringify(featureList));
    this._activeFeatures = featureList;
  },

  /**
   * Gets all the active producers from last session in the form of an array
   * containing all the active producer's ID.
   */
  get activeProducers() {
    if (this._activeProducers === undefined) {
      this._activeProducers = JSON.parse(
        Services.prefs.getCharPref("devtools.timeline.activeProducers"));
    }
    return this._activeProducers;
  },

  /**
   * Sets the preferred active producers.
   * @param array producerList
   */
  set activeProducers(producerList) {
    Services.prefs.setCharPref("devtools.timeline.activeProducers",
                               JSON.stringify(producerList));
    this._activeProducers = JSONproducerList;
  },

  /**
   * Gets all the visible Panes visible in the UI.
   */
  get visiblePanes() {
    if (this._visiblePanes === undefined) {
      this._visiblePanes = JSON.parse(
        Services.prefs.getCharPref("devtools.timeline.visiblePanes"));
    }
    return this._visiblePanes;
  },

  /**
   * Sets the preferred visible Panes in the UI.
   * @param array panesList
   */
  set visiblePanes(panesList) {
    Services.prefs.setCharPref("devtools.timeline.visiblePanes",
                               JSON.stringify(panesList));
    this._visiblePanes = panesList;
  },

  /**
   * Gets all the Producers visible in the UI that are not collapsed.
   */
  get visibleProducers() {
    if (this._visibleProducers === undefined) {
      this._visibleProducers = JSON.parse(
        Services.prefs.getCharPref("devtools.timeline.visibleProducers"));
    }
    return this._visibleProducers;
  },

  /**
   * Sets the preferred visible producers.
   * @param array producersList
   */
  set visibleProducers(producersList) {
    Services.prefs.setCharPref("devtools.timeline.visibleProducers",
                               JSON.stringify(panesList));
    this._visibleProducers = producersList;
  },
};
