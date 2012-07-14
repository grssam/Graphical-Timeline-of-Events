/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/frontend/timeline-canvas.jsm");

var EXPORTED_SYMBOLS = ["Timeline"];

/**
 * List of message types that the UI can send.
 */
const UIEventMessageType = {
  PING_HELLO: 0, // Tells the remote Data Sink that a UI has been established.
  INIT_DATA_SINK: 1, // Initialize the Data Sink and start all the producers.
  DESTROY_DATA_SINK: 2, // Destroy the Data Sink and stop all producer activity.
  START_RECORDING: 3, // To only start all the producers with given features.
  STOP_RECORDING: 4, // To only stop all the producers with given features.
  START_PRODUCER: 5, // To start a single producer.
  STOP_PRODUCER: 6, // To stop a single producer.
  ENABLE_FEATURES: 7, // To enable features of a producer.
  DISABLE_FEATURES: 8, // To disable features of a producer.
  ADD_WINDOW: 9, // Add another window to listen for tab based events.
  REMOVE_WINDOW: 10, // Stop listening for events for tab based events.
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

const COLOR_LIST = ["#1eff07", "#0012ff", "#20dbec", "#33b5ff", "#a8ff9c", "#b3f7ff",
                    "#f9b4ff", "#f770ff", "#ff0000", "#ff61fd", "#ffaf60", "#fffc04"];

const HTML = "http://www.w3.org/1999/xhtml";

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
  this.canvasStarted = false;
  this.recording = false;
  this.producersPaneOpened = false;
  this.startingoffsetTime = null;
  this.infoBoxHidden = false;
  this.tickerGroups = [];

  this._frame = ownerDocument.createElement("iframe");
  this._frame.height = TimelinePreferences.height;
  this._nbox = gBrowser.getNotificationBox(gBrowser.selectedTab.linkedBrowser);
  this._nbox.appendChild(this._splitter);
  this._nbox.appendChild(this._frame);
  this._canvas = null;

  this.toggleProducersPane = this.toggleProducersPane.bind(this);
  this.toggleOverview = this.toggleOverview.bind(this);
  this.toggleInfoBox = this.toggleInfoBox.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.toggleFeature = this.toggleFeature.bind(this);
  this.toggleMovement = this.toggleMovement.bind(this);
  this.toggleProducer = this.toggleProducer.bind(this);
  this.toggleProducerBox = this.toggleProducerBox.bind(this);
  this.handleGroupClick = this.handleGroupClick.bind(this);
  this.handleTickerClick = this.handleTickerClick.bind(this);
  this.pinUnpinDetailBox = this.pinUnpinDetailBox.bind(this);
  this.handleMousemove = this.handleMousemove.bind(this);
  this.onTickerScroll = this.onTickerScroll.bind(this);
  this.handleScroll = this.handleScroll.bind(this);
  this.handleTimeWindow = this.handleTimeWindow.bind(this);
  this.onProducersScroll = this.onProducersScroll.bind(this);
  this.onCanvasScroll = this.onCanvasScroll.bind(this);
  this.onFrameResize = this.onFrameResize.bind(this);
  this.resizeCanvas = this.resizeCanvas.bind(this);
  this.$ = this.$.bind(this);
  this._onLoad = this._onLoad.bind(this);
  this._onDragStart = this._onDragStart.bind(this);
  this._onDrag = this._onDrag.bind(this);
  this._onDragEnd = this._onDragEnd.bind(this);
  this._onWindowStart = this._onWindowStart.bind(this);
  this._onWindowSelect = this._onWindowSelect.bind(this);
  this._onWindowEnd = this._onWindowEnd.bind(this);
  this._onUnload = this._onUnload.bind(this);

  this._frame.addEventListener("load", this._onLoad, true);
  this._frame.setAttribute("src", "chrome://graphical-timeline/content/frontend/timeline.xul");
}

TimelineView.prototype = {

  /**
   * Attaches various events and sets references to the different parts of the UI.
   */
  _onLoad: function TV__onLoad()
  {
    this.loaded = true;
    this._frame.removeEventListener("load", this._onLoad, true);
    this._frameDoc = this._frame.contentDocument;
    this.closeButton = this.$("close");
    this.recordButton = this.$("record");
    this.overviewButton = this.$("overview");
    this.infoBox = this.$("timeline-infobox");
    this.detailBox = this.$("timeline-detailbox");
    this.producersButton = this.$("producers");
    this.infoBoxButton = this.$("infobox");
    this.producersPane = this.$("producers-pane");
    this.timeWindow = this.$("timeline-time-window");
    // Attaching events.
    this._frameDoc.defaultView.onresize = this.onFrameResize;
    this.producersPane.onscroll = this.onProducersScroll;
    this.$("timeline-canvas-dots").addEventListener("MozMousePixelScroll", this.onCanvasScroll, true);
    this.$("timeline-canvas-dots").addEventListener("mousemove", this.handleMousemove, true);
    this.$("stack-panes-splitter").addEventListener("mouseup", this.resizeCanvas, true);
    this.closeButton.addEventListener("command", Timeline.destroy, true);
    this.infoBox.addEventListener("click", this.handleTickerClick, true);
    this.infoBox.addEventListener("MozMousePixelScroll", this.onTickerScroll, true);
    this.overviewButton.addEventListener("command", this.toggleOverview, true);
    this.recordButton.addEventListener("command", this.toggleRecording, true);
    this.producersButton.addEventListener("command", this.toggleProducersPane, true);
    this.infoBoxButton.addEventListener("command", this.toggleInfoBox, true);
    this._frame.addEventListener("unload", this._onUnload, true);
    // Building the UI according to the preferences.
    this.overviewButton.setAttribute("checked", true);
    if (TimelinePreferences.visiblePanes.indexOf("producers") == -1) {
      this.producersPane.style.marginLeft = (-1*this.producersPane.boxObject.width) + "px";
      this.producersPane.setAttribute("visible", false);
      this.producersPaneOpened = false;
      this.producersButton.checked = false;
    }
    else {
      this.producersPane.style.marginLeft = "0px";
      this.producersPane.setAttribute("visible", true);
      this.producersPaneOpened = true;
      this.producersButton.checked = true;
    }
    if (TimelinePreferences.visiblePanes.indexOf("infobox") == -1) {
      this.infoBox.setAttribute("visible", false);
      this.infoBoxHidden = true;
      this.infoBoxButton.checked = false;
    }
    else {
      this.infoBox.setAttribute("visible", true);
      this.infoBoxHidden = false;
      this.infoBoxButton.checked = true;
    }
  },

  /**
   * Updates the UI with the given list of active features and producers.
   * Also changes the preferences accordingly.
   *
   * @param aMessage
   *        @see DataSink.init()
   */
  updateUI: function TV_updateUI(aMessage)
  {
    let enabledProducers = [];
    let enabledFeatures = [];
    let producerBoxes = this._frameDoc.getElementsByClassName("producer-box");
    for (let i = 0; i < producerBoxes.length; i++) {
      let producerBox = producerBoxes[i];
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
    TimelinePreferences.activeFeatures = enabledFeatures;
    TimelinePreferences.activeProducers = enabledProducers;
  },

  addGroupBox: function TV_addGroupBox(aData)
  {
    let producerBox = this.$(aData.producer + "-box");
    if (!producerBox) {
      return;
    }
    let featureBox = producerBox.firstChild.nextSibling;
    let urlLabel = this._frameDoc.createElement("label");
    urlLabel.setAttribute("id", aData.groupID.replace(" ", "_") + "-groupbox");
    urlLabel.setAttribute("class", "timeline-groubox");
    urlLabel.setAttribute("groupId", aData.groupID);
    urlLabel.setAttribute("shouldDelete", true);
    urlLabel.setAttribute("value", aData.name);
    urlLabel.setAttribute("tooltiptext", aData.nameTooltip || "");
    urlLabel.setAttribute("flex", "0");
    urlLabel.setAttribute("crop", "center");
    featureBox.appendChild(urlLabel);
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
  createProducersPane: function TV_createProducersPane(aProducerInfoList)
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
      let enableButton = this._frameDoc.createElement("checkbox");
      enableButton.setAttribute("class", "devtools-checkbox");
      if (TimelinePreferences.activeProducers.indexOf(producer.id) != -1) {
        enableButton.setAttribute("checked", true);
      }
      enableButton.addEventListener("command", this.toggleProducer, true);
      nameBox.appendChild(enableButton);
      let collapseButton = this._frameDoc.createElement("toolbarbutton");
      collapseButton.setAttribute("class", "producer-collapse-button");
      collapseButton.addEventListener("command", this.toggleProducerBox, true);
      nameBox.appendChild(collapseButton);
      producerBox.appendChild(nameBox);

      // The features box contains list of each feature and a checkbox to toggle
      // that feature.
      let featureBox = this._frameDoc.createElement("vbox");
      featureBox.setAttribute("class", "producer-feature-box");
      featureBox.setAttribute("producerId", producer.id);
      featureBox.addEventListener("click", this.handleGroupClick, true);
      for each (let feature in producer.features) {
        let featureCheckbox = this._frameDoc.createElement("checkbox");
        featureCheckbox.setAttribute("id", feature.replace(" ", "_") + "-groupbox");
        featureCheckbox.setAttribute("class", "devtools-checkbox");
        featureCheckbox.setAttribute("flex", "1");
        featureCheckbox.setAttribute("label", feature);
        featureCheckbox.setAttribute("groupId", feature.replace(" ", "_"));
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
   * Cleans the UI and brings it to initial state, removing every group box
   * added dynamically during this recording.
   */
  cleanUI: function TV_cleanUI()
  {
    let producerBox = this.producersPane.firstChild;
    while (producerBox) {
      let feature = producerBox.firstChild.nextSibling.firstChild;
      while (feature) {
        if (feature.hasAttribute("shouldDelete")) {
          let temp = feature;
          feature = temp.nextSibling;
          temp.parentNode.removeChild(temp);
        }
        else {
          feature = feature.nextSibling;
        }
      }
      producerBox = producerBox.nextSibling;
    }
    let feed = this.infoBox.firstChild;
    while (feed) {
      let temp = feed;
      feed = temp.nextSibling;
      this.infoBox.removeChild(temp);
    }
  },

  /**
   * Stops the timeline view to current time frame.
   */
  toggleMovement: function TV_toggleMovement()
  {
    if (!this._canvas.timeFrozen) {
      this._canvas.freezeCanvas();
      this.overviewButton.setAttribute("checked", true);
      this.freezeTicker();
    }
    else {
      this._canvas.moveToCurrentTime();
      this.unfreezeTicker();
    }
  },

  onFrameResize: function TV_onFrameResize()
  {
    if (this.canvasStarted) {
      if (Math.abs(this.producersPane.clientHeight - this._canvas.height) > 50) {
        this._canvas.height = this.producersPane.clientHeight;
      }
    }
  },

  /**
   * Toggles the Producers Pane.
   */
  toggleProducersPane: function TV_toggleProducersPane()
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

  _showProducersPane: function TV__showProducersPane()
  {
    this.producersPaneOpened = true;
    this.producersPane.style.marginLeft = "0px";
    this.producersPane.setAttribute("visible", true);
    if (this.canvasStarted) {
      this._canvas.height = this.$("canvas-container").boxObject.height - 25;
      this._canvas.width = this.$("timeline-content").boxObject.width - this.producersPane.boxObject.width;
    }
  },

  _hideProducersPane: function TV__hideProducersPane()
  {
    this.producersPaneOpened = false;
    this.producersPane.style.marginLeft = (-1*this.producersPane.boxObject.width) + "px";
    this.producersPane.setAttribute("visible", false);
    if (this.canvasStarted) {
      this._canvas.height = this.$("canvas-container").boxObject.height - 25;
      this._canvas.width = this.$("timeline-content").boxObject.width;
    }
  },

  toggleInfoBox: function TV_toggleInfoBox()
  {
    if (!this.infoBoxHidden) {
      this.infoBox.setAttribute("visible", false);
      this.infoBoxHidden = true;
    }
    else {
      this.infoBox.setAttribute("visible", true);
      this.infoBoxHidden = false;
    }
  },

  /**
   * Starts and stops the listening of Data.
   */
  toggleRecording: function TV_toggleRecording()
  {
    if (!this.recording) {
      let message = {
        enabledProducers: {},
        timelineUIId: Timeline.id,
      };
      let producerBoxes = this._frameDoc.getElementsByClassName("producer-box");
      for (let i = 0; i < producerBoxes.length; i++) {
        let producerBox = producerBoxes[i];
        let id = producerBox.getAttribute("producerId");
        if (producerBox.getAttribute("enabled") == "true") {
          message.enabledProducers[id] = {features: []};
          let feature = producerBox.firstChild.nextSibling.firstChild;
          while (feature) {
            if (feature.hasAttribute("checked")) {
              message.enabledProducers[id].features.push(feature.getAttribute("label"));
            }
            feature = feature.nextSibling;
          }
        }
      }
      this.cleanUI();
      Timeline.startListening(message);
      // Starting the canvas.
      if (!this.canvasStarted) {
        this._canvas = new CanvasManager(this._frameDoc);
        this._canvas.height = this.$("canvas-container").boxObject.height - 25;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
        this.$("timeline-current-time").style.left = this._canvas.width*0.8 + "px";
        this.canvasStarted = true;
        this.handleScroll();
        this.handleDetailClick();
        this.handleTimeWindow();
      }
      else {
        this._canvas.height = this.$("canvas-container").boxObject.height - 25;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
        this._canvas.startRendering();
        if (!this.overviewButton.hasAttribute("checked")) {
          this._canvas.moveToLive();
        }
      }
    }
    else {
      this._canvas.stopRendering();
      Timeline.stopListening({timelineUIId: Timeline.id});
    }
    this.recording = !this.recording;
  },

  toggleOverview: function TV_toggleOverview()
  {
    if (!this.canvasStarted) {
      return;
    }
    if (this.overviewButton.checked) {
      if (this._canvas.timeFrozen) {
        this.toggleMovement();
      }
      this._canvas.moveToOverview();
    }
    else {
      this._canvas.moveToLive();
    }
  },

  /**
   * Toggles the feature.
   *
   * @param object aEvent
   *        Associated event for the command event call.
   */
  toggleFeature: function TV_toggleFeature(aEvent)
  {
    if (!this.recording) {
      return;
    }
    let target = aEvent.target;
    let linkedProducerId = target.parentNode.getAttribute("producerId");
    let feature = target.getAttribute("label");
    if (target.hasAttribute("checked")) {
      Timeline.enableFeatures(linkedProducerId, [feature]);
    }
    else {
      Timeline.disableFeatures(linkedProducerId, [feature]);
    }
  },

  /**
   * Toggles the producer.
   *
   * @param object aEvent
   *        Associated event for the command event call.
   */
  toggleProducer: function TV_toggleProducer(aEvent)
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
      Timeline.startProducer(producerId, features);
    }
    else {
      Timeline.stopProducer(producerId);
    }
  },

  resizeCanvas: function TV_resizeCanvas()
  {
    if (this.canvasStarted) {
      this._canvas.width = this.$("timeline-content").boxObject.width -
        (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
    }
  },

  onProducersScroll: function TV_onProducersScroll(aEvent)
  {
    if (aEvent.target.scrollTop) {
      this._canvas.offsetTop = aEvent.target.scrollTop;
      this._canvas.waitForLineData = false;
      this._canvas.waitForDotData = false;
    }
  },

  onCanvasScroll: function TV_onCanvasScroll(aEvent)
  {
    if (aEvent.detail) {
      aEvent.preventDefault();
      this.producersPane.scrollTop = Math.max(0, this._canvas.offsetTop + aEvent.detail);
      this._canvas.offsetTop = this.producersPane.scrollTop;
      this._canvas.waitForLineData = false;
      this._canvas.waitForDotData = false;
    }
  },

  onTickerScroll: function TV_onTickerScroll(aEvent)
  {
    if (aEvent.detail) {
      aEvent.preventDefault();
      aEvent.stopPropagation();
      this.infoBox.scrollTop = Math.max(0, this.infoBox.scrollTop + aEvent.detail);
    }
  },

  freezeTicker: function TV_freezeTicker()
  {
    this.infoBox.scrollTop = 1;
  },

  unfreezeTicker: function TV_unfreezeTicker()
  {
    this.infoBox.scrollTop = 0;
  },

  moveTickerToTime: function TV_moveTickerToTime(aTime)
  {
    try {
      if (this.infoBox.firstChild.getAttribute("timestamp")*1 < aTime) {
        return;
      }
      let child = this.infoBox.firstChild, height = 0;
      while(child) {
        if (child.getAttribute("timestamp")*1 < aTime) {
          this.infoBox.scrollTop = height;
          break;
        }
        height += child.boxObject.height;
        child = child.nextSibling;
      }
    } catch (ex) {}
  },

  /**
   * Toggles the producer box.
   *
   * @param object aEvent
   *        Associated event for the command event call.
   */
  toggleProducerBox: function TV_toggleProducerBox(aEvent)
  {
    let producerBox = aEvent.target.parentNode.parentNode;
    if (!producerBox) {
      return;
    }
    if (producerBox.getAttribute("visible") == "true") {
      producerBox.setAttribute("visible", false);
    }
    else {
      producerBox.setAttribute("visible", true);
    }
    if (this.canvasStarted) {
      this._frameDoc.defaultView.setTimeout(function() {
        this._canvas.offsetTop = this.producersPane.scrollTop;
        this._canvas.updateGroupOffset();
        this._canvas.waitForLineData = false;
        this._canvas.waitForDotData = false;
      }.bind(this), 500);
    }
  },

  handleGroupClick: function TV_handleGroupClick(aEvent)
  {
    let group = aEvent.originalTarget;
    if (group.localName == "label" && group.hasAttribute("groupId")) {
      this._canvas.moveGroupInView(group.getAttribute("groupId"));
      this.moveTickerToTime(this._canvas.groupedData[
        group.getAttribute("groupId")].timestamps[0]);
    }
  },

  pinUnpinDetailBox: function TV_pinUnpinDetailBox()
  {
    if (this.detailBox.getAttribute("pinned") == "false" &&
        this.detailBox.getAttribute("visible") == "true") {
      this.detailBox.setAttribute("pinned", true);
    }
    else {
      this.detailBox.setAttribute("pinned", false);
    }
  },

  handleDetailClick: function TV_handleDetailClick()
  {
    this.$("timeline-canvas-dots").addEventListener("mousedown", this.pinUnpinDetailBox);
  },

  handleMousemove: function TV_handleMousemove(aEvent)
  {
    if (this.canvasStarted) {
      let ids = this._canvas
                    .mouseHoverAt(aEvent.clientX -
                                  (!this.producersPaneOpened?
                                    0: this.producersPane.boxObject.width),
                                  aEvent.clientY - 32);
      if (ids && ids.length > 0) {
        let id = ids[ids.length - 1];
        if (this.detailBox.hasAttribute("dataId") && this.detailBox.getAttribute("dataId") == id) {
          return;
        }
        this.detailBox.setAttribute("dataId", id);
        let tmp = this.detailBox.firstChild;
        while (tmp) {
          let temp = tmp.nextSibling;
          tmp.parentNode.removeChild(tmp);
          tmp = temp;
        }
        let propLabel = this._frameDoc.createElement("label");
        propLabel.setAttribute("class", "property-heading");
        propLabel.setAttribute("value", this.producerInfoList[Timeline.data[id].producer].name);
        this.detailBox.appendChild(propLabel);
        if (Timeline.data[id].details) {
          for (let property in this.producerInfoList[Timeline.data[id].producer]
                                   .details) {
            if (Timeline.data[id].details[property] == null){
              continue;
            }
            if (this.producerInfoList[Timeline.data[id].producer]
                    .details[property].type != "nested") {
              let {name:name, value:value} =
                this.getPropertyInfo(Timeline.data[id].producer,
                                     property,
                                     Timeline.data[id].details[property]);
              let propLine = this._frameDoc.createElement("hbox");
              let nameLabel = this._frameDoc.createElement("label");
              let valueLabel = this._frameDoc.createElement("label");
              nameLabel.setAttribute("value", name + " :");
              nameLabel.setAttribute("crop", "left");
              valueLabel.setAttribute("value", value);
              valueLabel.setAttribute("crop", "center");
              propLine.appendChild(nameLabel);
              propLine.appendChild(valueLabel);
              propLine.setAttribute("class", "property-line");
              this.detailBox.appendChild(propLine);
            }
            else {
              let propLabel = this._frameDoc.createElement("label");
              propLabel.setAttribute("value", this.producerInfoList[
                                                Timeline.data[id].producer
                                              ].details[property].name);
              propLabel.setAttribute("class", "detailed-heading");
              this.detailBox.appendChild(propLabel);
              for (let subProp in this.producerInfoList[
                                    Timeline.data[id].producer
                                  ].details[property].items) {
                if (Timeline.data[id].details[property][subProp] == null){
                  continue;
                }
                let {name:name, value:value} =
                  this.getPropertyInfo(Timeline.data[id].producer,
                                       property,
                                       Timeline.data[id].details[property][subProp],
                                       subProp);
                let propLine = this._frameDoc.createElement("hbox");
                let nameLabel = this._frameDoc.createElement("label");
                let valueLabel = this._frameDoc.createElement("label");
                nameLabel.setAttribute("value", name + " :");
                nameLabel.setAttribute("crop", "left");
                valueLabel.setAttribute("value", value);
                valueLabel.setAttribute("crop", "center");
                propLine.appendChild(nameLabel);
                propLine.appendChild(valueLabel);
                propLine.setAttribute("class", "property-line");
                this.detailBox.appendChild(propLine);
              }
            }
          }
        }
      }
    }
  },

  handleTickerClick: function TV_handleTickerClick(aEvent)
  {
    let group = aEvent.originalTarget;
    if (group.localName == "label") {
      group = group.parentNode;
    }
    if (group.hasAttribute("timestamp")) {
      this._canvas.moveToTime(group.getAttribute("timestamp")*1);
      this._canvas.moveTopOffsetTo(this._canvas
          .groupedData[group.getAttribute("groupId")].y);
    }
  },

  /**
   * Adds a short summary of the event in the ticker box.
   *
   * @param object aData
   *        Normalized event data.
   * @param number aId
   *        used to identify the color of text.
   */
  addToTicker: function TV_addToTicker(aData, aId)
  {
    if (this.infoBoxHidden) {
      return;
    }
    if (aData.type != NORMALIZED_EVENT_TYPE.POINT_EVENT &&
        this.tickerGroups.indexOf(aData.groupID) != -1) {
      return;
    }
    let scrollTop = this.infoBox.scrollTop;
    let feedItem = this._frameDoc.createElement("vbox");
    if (scrollTop == 0) {
      // Animate in
      feedItem.setAttribute("class", "ticker-feed animate-in");
    }
    else {
      feedItem.setAttribute("class", "ticker-feed");
    }
    feedItem.setAttribute("groupId", aData.groupID);
    feedItem.setAttribute("timestamp", aData.time);
    let label1 = this._frameDoc.createElement("label");
    label1.setAttribute("style", "color:" + COLOR_LIST[aId%12]);
    let label2 = this._frameDoc.createElement("label");
    label2.setAttribute("style", "color:" + COLOR_LIST[aId%12]);
    let dateString = (new Date(aData.time)).getHours() + ":" +
                     (new Date(aData.time)).getMinutes() + ":" +
                     (new Date(aData.time)).getSeconds();
    label1.setAttribute("value", aData.name);
    feedItem.appendChild(label1);
    if (aData.details) {
      for (let property in aData.details) {
        if (Timeline.producerInfoList[aData.producer]
                    .details[property].type != "nested") {
          let {name:name, value:value} =
            this.getPropertyInfo(aData.producer,
                                 property,
                                 aData.details[property]);
          label2.setAttribute("value", name + ": " + value + " at " + dateString);
          feedItem.appendChild(label2);
        }
        else {
          for (let subProp in aData.details[property].items) {
            let {name:name, value:value} =
              this.getPropertyInfo(aData.producer,
                                   property,
                                   aData.details[property].items[subProp],
                                   subProp);
            label2.setAttribute("value", name + ": " + value + " at " + dateString);
            feedItem.appendChild(label2);
            break;
          }
        }
        break;
      }
    }
    this.tickerGroups.push(aData.groupID);
    if (!this.infoBox.firstChild) {
      this.infoBox.appendChild(feedItem);
    }
    else {
      this.infoBox.insertBefore(feedItem, this.infoBox.firstChild);
    }
    if (scrollTop != 0) {
      this.infoBox.scrollTop += feedItem.boxObject.height;
    }
  },

  /**
   * Returns display name and value corresponding to a property.
   *
   * @param string aProducerId
   *        producer ID corresponding to the property.
   * @param string aName
   *        Name of the property.
   * @param * aValue
   *        Value of the property.
   * @param string aSubName
   *        sub property name in case of nested type.
   * @return {name: _name_, value: _value_}
   *         _name_ is the display name, _value_ is the display value.
   */
  getPropertyInfo: function TV_getPropertyInfo(aProducerId, aName, aValue, aSubName)
  {
    if (Timeline.producerInfoList[aProducerId].details[aName]) {
      let details = Timeline.producerInfoList[aProducerId].details;
      let type = details[aName].type;
      let name,value;
      if (type == "nested") {
        if (aSubName != null) {
          type = details[aName].items[aSubName].type;
          details = details[aName].items;
          aName = aSubName;
        }
        else {
          return null;
        }
      }
      switch (type) {
        case "string":
        case "number":
          value = aValue;
          name = details[aName].name;
          break;

        case "date":
          value = (new Date(aValue)).getHours() + ":" +
                  (new Date(aValue)).getMinutes() + ":" +
                  (new Date(aValue)).getSeconds();
          name = details[aName].name;
          break;

        case "enum":
          name = details[aName].name;
          value = details[aName].values[aValue] || "null";
          break;

        default:
          return null;
      }
      return {name: name, value: value};
    }
    return null;
  },

  /**
   * Gets the data and sends it to the canvas to display
   *
   * @param object aData
   *        Normalized event data.
   */
  displayData: function NV_displayData(aData)
  {
    if (!this._canvas.hasGroup(aData)) {
      this.addGroupBox(aData);
      this._canvas.updateGroupOffset();
    }
    let id = this._canvas.pushData(aData);
    this.addToTicker(aData, id);
  },

  _onDragStart: function TV__onDragStart(aEvent)
  {
    this.scrollStartX = aEvent.clientX;
    this.$("timeline-ruler").removeEventListener("mousedown", this._onDragStart, true);
    if (!this._canvas.timeFrozen) {
      this._canvas.freezeCanvas();
    }
    this._canvas.startScrolling();
    this.$("canvas-container").addEventListener("mousemove", this._onDrag, true);
    this._frameDoc.addEventListener("mouseup", this._onDragEnd, true);
    this._frameDoc.addEventListener("click", this._onDragEnd, true);
  },

  _onDrag: function TV__onDrag(aEvent)
  {
    this._canvas.scrollDistance = this.scrollStartX - aEvent.clientX;
  },

  _onDragEnd: function TV__onDragEnd(aEvent)
  {
    this._canvas.stopScrolling();
    this.$("canvas-container").removeEventListener("mousemove", this._onDrag, true);
    this._frameDoc.removeEventListener("mouseup", this._onDragEnd, true);
    this._frameDoc.removeEventListener("click", this._onDragEnd, true);
    this.moveTickerToTime(this._canvas.lastVisibleTime);
    this.handleScroll();
  },

  /**
   * Handles dragging of the current time vertical line to scroll to previous time.
   */
  handleScroll: function TV_handleScroll()
  {
    this.$("timeline-ruler").addEventListener("mousedown", this._onDragStart, true);
  },

  _onWindowStart: function TV__onWindowStart(aEvent)
  {
    this.$("timeline-canvas-dots").removeEventListener("mousedown", this._onWindowStart, true);
    this.timeWindow.setAttribute("selecting", true);
    let left = aEvent.clientX - (!this.producersPaneOpened?0:this.producersPane.boxObject.width);
    this.timeWindow.style.right = this.timeWindow.style.left = left + "px";
    this.timeWindow.style.width = "0px";
    this.$("canvas-container").addEventListener("mousemove", this._onWindowSelect, true);
    this._frameDoc.addEventListener("mouseup", this._onWindowEnd, true);
    this._frameDoc.addEventListener("click", this._onWindowEnd, true);
    this._canvas.startTimeWindowAt(left);
  },

  _onWindowSelect: function TV__onWindowSelect(aEvent)
  {
    this.timeWindow.style.width = (aEvent.clientX -
      (!this.producersPaneOpened?0:this.producersPane.boxObject.width) -
      this.timeWindow.style.left.replace("px", "")*1) + "px";
  },

  _onWindowEnd: function TV__onWindowEnd(aEvent)
  {
    this.$("canvas-container").removeEventListener("mousemove", this._onWindowSelect, true);
    this._frameDoc.removeEventListener("mouseup", this._onWindowEnd, true);
    this._frameDoc.removeEventListener("click", this._onWindowEnd, true);
    this._canvas.stopTimeWindowAt(aEvent.clientX -
      (!this.producersPaneOpened?0:this.producersPane.boxObject.width));
    if (!this._canvas.overview) {
      this._frameDoc.defaultView.setTimeout(function() {
        this.moveTickerToTime(this._canvas.lastVisibleTime);
      }.bind(this), 50);
    }
    try {
      this.timeWindow.removeAttribute("selecting");
    } catch (ex) {}
    this.timeWindow.setAttribute("selected", true);
    this._frameDoc.defaultView.setTimeout(function() {
      this.timeWindow.removeAttribute("selected");
    }.bind(this), 500);
    this.handleTimeWindow();
  },

  /**
   * Handles dragging of the time window line to select a time range.
   */
  handleTimeWindow: function TV_handleTimeWindow()
  {
    this.$("timeline-canvas-dots").addEventListener("mousedown", this._onWindowStart, true);
  },
  /**
   * Closes the UI, removes the frame and the splitter ans dispatches an
   * unloading event to tell the parent window.
   */
  closeUI: function TV_closeUI()
  {
    if (!this.loaded) {
      return;
    }

    // Updating the preferences.
    TimelinePreferences.height = this._frame.height;
    let visiblePanes = [];
    if (this.producersPane.getAttribute("visible") == "true") {
      visiblePanes.push("producers");
    }
    if (this.infoBox.getAttribute("visible") == "true") {
      visiblePanes.push("infobox");
    }
    TimelinePreferences.visiblePanes = visiblePanes;
    let producerBoxes = this._frameDoc.getElementsByClassName("producer-box");
    let visibleProducers = [], activeFeatures = [], activeProducers = [];
    for (let i = 0; i < producerBoxes.length; i++) {
      let producerBox = producerBoxes[i];
      let id = producerBox.getAttribute("producerId");
      if (producerBox.getAttribute("visible") == "true") {
        visibleProducers.push(id);
      }
      if (producerBox.getAttribute("enabled") == "true") {
        activeProducers.push(id);
      }
      let feature = producerBox.firstChild.nextSibling.firstChild;
      while (feature) {
        if (feature.hasAttribute("checked")) {
          activeFeatures.push(id + ":" + feature.getAttribute("label"));
        }
        feature = feature.nextSibling;
      }
    }
    TimelinePreferences.visibleProducers = visibleProducers;
    TimelinePreferences.activeFeatures = activeFeatures;
    TimelinePreferences.activeProducers = activeProducers;

    // Removing frame and splitter.
    this._splitter.parentNode.removeChild(this._splitter);
    this._frame.parentNode.removeChild(this._frame);
  },

  _onUnload: function TV__onUnload()
  {
    this._frame = null;
    this._frameDoc = null;
    this._splitter = null;
    this._window = null;
    this.loaded = false;
  },

  /**
   * Equivalent function to this._frameDoc.getElementById(ID)
   */
  $: function TV_$(ID) {
    return this._frameDoc.getElementById(ID);
  },
};

/**
 * The Timeline User Interface
 */
let Timeline = {

  _view: null,
  _currentId: 1,
  _window: null,
  //_console: null,

  UIOpened: false,
  listening: false,
  pingSent: false,
  newDataAvailable: false,
  readingData: false,
  databaseName: "",
  shouldDeleteDatabaseItself: true,
  producerInfoList: null,
  id: null,
  timer: null,
  callback: null,
  data: {},

  /**
   * Prepares the UI and sends ping to the Data Sink.
   */
  init: function GUI_init(aCallback) {
    Timeline.callback = aCallback;
    Timeline._window = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    //Timeline._console = Cc["@mozilla.org/consoleservice;1"]
    //                     .getService(Ci.nsIConsoleService);
    Timeline.addRemoteListener(Timeline._window);
    if (!Timeline.id) {
      Timeline.id = "timeline-ui-" + Date.now();
    }
    Timeline.pingSent = true;
    Timeline.sendMessage(UIEventMessageType.PING_HELLO,
                        {timelineUIId: Timeline.id});
  },

  /**
   * Builds the UI in the Tab.
   */
  buildUI: function GUI_buildUI() {
    if (!Timeline._view) {
      Timeline._view = new TimelineView(Timeline._window);
    }
    Timeline._view.createProducersPane(Timeline.producerInfoList);
    Timeline.UIOpened = true;
  },

  /**
   * Starts the Data Sink and all the producers.
   */
  startListening: function GUI_startListening(aMessage) {
    //Timeline.timer = Timeline._window.setInterval(Timeline.readData, 25);
    Timeline.sendMessage(UIEventMessageType.START_RECORDING, aMessage);
    Timeline.listening = true;
    Timeline.shouldDeleteDatabaseItself = false;
  },

  /**
   * Stops the Data Sink and all the producers.
   */
  stopListening: function GUI_stopListening(aMessage) {
    if (!Timeline.listening) {
      return;
    }
    //Timeline._window.clearInterval(Timeline.timer);
    //Timeline.timer = null;
    Timeline.sendMessage(UIEventMessageType.STOP_RECORDING, aMessage);
    Timeline.listening = false;
  },

  /**
   * Handles the ping response from the Data Sink.
   *
   * @param object aMessage
   *        Ping response message containing either the databse name on success
   *        or the error on failure.
   */
  handlePingReply: function GUI_handlePingReply(aMessage) {
    if (!aMessage || aMessage.timelineUIId != Timeline.id || !Timeline.pingSent) {
      return;
    }
    if (aMessage.error) {
      switch (aMessage.error) {

        case ERRORS.ID_TAKEN:
          // The id was already taken, generate a new id and send the ping again.
          Timeline.id = "timeline-ui-" + Date.now();
          Timeline.sendMessage(UIEventMessageType.PING_HELLO,
                              {timelineUIId: Timeline.id});
          break;
      }
    }
    else {
      Timeline.databaseName = aMessage.databaseName;
      Timeline.producerInfoList = aMessage.producerInfoList;
      // Importing the Data Store and making a database
      //Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
      //Timeline.dataStore = new DataStore(Timeline.databaseName);
      Timeline.buildUI();
    }
  },

  /**
   * Tells the Data Sink to start the given features of a producer.
   *
   * @param string aProducerId
   *        Id of the producer whose events would be disabled.
   * @param array aFeatures
   *        List of features that should be enabled.
   */
  enableFeatures: function GUI_enableFeatures(aProducerId, aFeatures)
  {
    let message = {
      timelineUIId: Timeline.id,
      producerId: aProducerId,
      features: aFeatures,
    };
    Timeline.sendMessage(UIEventMessageType.ENABLE_FEATURES, message);
  },

  /**
   * Tells the Data Sink to stop the given features of a  producer.
   *
   * @param string aProducerId
   *        Id of the producer whose events would be disabled.
   * @param array aFeatures
   *        List of features that should be disabled.
   */
  disableFeatures: function GUI_disableFeatures(aProducerId, aFeatures)
  {
    let message = {
      timelineUIId: Timeline.id,
      producerId: aProducerId,
      features: aFeatures,
    };
    Timeline.sendMessage(UIEventMessageType.DISABLE_FEATURES, message);
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
      timelineUIId: Timeline.id,
      producerId: aProducerId,
      features: aFeatures,
    };
    Timeline.sendMessage(UIEventMessageType.START_PRODUCER, message);
  },

  /**
   * Tells the Data Sink to stop the given producer.
   *
   * @param string aProducerId
   *        Id of the producer to stop.
   */
  stopProducer: function GUI_stopProducer(aProducerId)
  {
    let message = {
      timelineUIId: Timeline.id,
      producerId: aProducerId,
    };
    Timeline.sendMessage(UIEventMessageType.STOP_PRODUCER, message);
  },

  /**
   * Check for any pending data to read and sends a request to Data Store.
   */
  readData: function GUI_readData() {
    if (Timeline.newDataAvailable && !Timeline.readingData) {
      Timeline.readingData = true;
      //Timeline.dataStore.getRangeById(Timeline.processData, Timeline._currentId);
    }
  },

  /**
   * Processes the data received from Data Store
   *
   * @param array aData
   *        Array of normalized data received from Data Store.
   */
  processData: function GUI_processData(aData) {
    Timeline.readingData = Timeline.newDataAvailable = false;
    Timeline._currentId += aData.length;
    for (let i = 0; i < aData.length; i++) {
      Timeline._view.displayData(aData[i]);
      Timeline.data[aData[i].id] = aData[i];
      // Timeline._console
             // .logStringMessage("ID: " + aData[i].id +
                               // "; Producer: " + aData[i].producer +
                               // "; Name: " + aData[i].name +
                               // "; Time: " + aData[i].time +
                               // "; Type: " + aData[i].type + "; Datails: " +
                               // (aData[i].producer == "NetworkProducer"? "url - " +
                                // aData[i].details.log.entries[0].request.url + " " +
                                // aData[i].details.log.entries[0].request.method + ";"
                                // : JSON.stringify(aData[i].details)));
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
        Timeline.handlePingReply(message);
        break;

      case DataSinkEventMessageType.NEW_DATA:
        Timeline.newDataAvailable = true;
        Timeline.processData([message]);
        break;

      case DataSinkEventMessageType.UPDATE_UI:
        if (message.timelineUIId != Timeline.id) {
          Timeline._view.updateUI(message);
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
                                   Timeline._remoteListener, true);
  },

  /**
   * Removes the remote event listener from a window.
   *
   * @param object aChromeWindow
   *        Reference to the chrome window from which listener is to be removed.
   */
  removeRemoteListener: function GUI_removeRemoteListener(aChromeWindow) {
    aChromeWindow.removeEventListener("GraphicalTimeline:DataSinkEvent",
                                      Timeline._remoteListener, true);
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
      new Timeline._window.CustomEvent("GraphicalTimeline:UIEvent", detail)
    Timeline._window.dispatchEvent(customEvent);
  },

  /**
   * Stops the UI, Data Sink and Data Store.
   */
  destroy: function GUI_destroy() {
    if (Timeline.UIOpened == true) {
      if (Timeline.listening) {
        //Timeline._window.clearInterval(Timeline.timer);
        //Timeline.timer = null;
      }
      //Timeline.dataStore.destroy(Timeline.shouldDeleteDatabaseItself);
      try {
        Cu.unload("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
      } catch (ex) {}
      //DataStore = Timeline.dataStore = null;
      Timeline.sendMessage(UIEventMessageType.DESTROY_DATA_SINK,
                           {deleteDatabase: true, // true to delete the database
                            timelineUIId: Timeline.id, // to tell which UI is closing.
                           });
      Timeline.shouldDeleteDatabaseItself = true;
      Timeline.pingSent = Timeline.listening = false;
      Timeline.removeRemoteListener(Timeline._window);
      Timeline._view.closeUI();
      Timeline._view = Timeline.newDataAvailable = Timeline.UIOpened =
        Timeline._currentId = Timeline._window = null;
      Timeline.producerInfoList = null;
      if (Timeline.callback)
        Timeline.callback();
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
    this._activeProducers = producerList;
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
                               JSON.stringify(producersList));
    this._visibleProducers = producersList;
  },
};
