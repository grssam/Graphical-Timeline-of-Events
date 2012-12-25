/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource://gre/modules/NetworkPanel.jsm");

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
  PAGE_RELOAD: 3, // Sent when the page being listened is refreshed.
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
 * @param iframe aIframe
 *        If you want the xul to reside inside an iframe, pass the iframe.
 */
function TimelineView(aChromeWindow, aIframe) {
  this._window = aChromeWindow;
  let gBrowser = this._window.gBrowser;
  this._iframe = aIframe || null;
  let ownerDocument = gBrowser.parentNode.ownerDocument;

  if (!this._iframe) {
    this._splitter = ownerDocument.createElement("hbox");
    this._splitter.setAttribute("class", "devtools-horizontal-splitter");
    this._splitter.style.cursor = "n-resize";
  }

  this.loaded = false;
  this.canvasStarted = false;
  this.recording = false;
  this.startingoffsetTime = null;
  this.continuousInLine = false;
  this.compactHeight = 120;
  this.compactMode = TimelinePreferences.compactMode;

  this._frame = this._iframe || ownerDocument.createElement("iframe");
  if (!this._iframe) {
    this._frame.height = TimelinePreferences.height;
    this._nbox = gBrowser.getNotificationBox(gBrowser.selectedTab.linkedBrowser);
    this._nbox.appendChild(this._splitter);
    this._nbox.appendChild(this._frame);
  }
  this._canvas = null;

  this.toggleOverview = this.toggleOverview.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.forceRestart = this.forceRestart.bind(this);
  this.toggleFeature = this.toggleFeature.bind(this);
  this.toggleMovement = this.toggleMovement.bind(this);
  this.toggleProducer = this.toggleProducer.bind(this);
  this.toggleProducerBox = this.toggleProducerBox.bind(this);
  this.handleGroupClick = this.handleGroupClick.bind(this);
  this.pinUnpinDetailBox = this.pinUnpinDetailBox.bind(this);
  this.toggleRestartOnReload = this.toggleRestartOnReload.bind(this);
  this.handleMousemove = this.handleMousemove.bind(this);
  this.handleMouseout = this.handleMouseout.bind(this);
  this.handleScroll = this.handleScroll.bind(this);
  this.handleScrollbarMove = this.handleScrollbarMove.bind(this);
  this.handleTimeWindow = this.handleTimeWindow.bind(this);
  this.onProducersScroll = this.onProducersScroll.bind(this);
  this.onProducersMouseScroll = this.onProducersMouseScroll.bind(this);
  this.onCanvasScroll = this.onCanvasScroll.bind(this);
  this.onFrameResize = this.onFrameResize.bind(this);
  this.resizeCanvas = this.resizeCanvas.bind(this);
  this.toggleCompactView = this.toggleCompactView.bind(this);
  this.zoomIn = this.zoom.bind(this, true);
  this.zoomOut = this.zoom.bind(this, false);
  this.closeDetailBox = this.closeDetailBox.bind(this);
  this.handleDetailBoxResize = this.handleDetailBoxResize.bind(this);
  this.handleFrameResize = this.handleFrameResize.bind(this);
  this.updateScrollbar = this.updateScrollbar.bind(this);
  this.$ = this.$.bind(this);
  this._onLoad = this._onLoad.bind(this);
  this._onDragStart = this._onDragStart.bind(this);
  this._onDrag = this._onDrag.bind(this);
  this._onDragEnd = this._onDragEnd.bind(this);
  this._onWindowStart = this._onWindowStart.bind(this);
  this._onWindowSelect = this._onWindowSelect.bind(this);
  this._onWindowEnd = this._onWindowEnd.bind(this);
  this._onScrollbarDragStart = this._onScrollbarDragStart.bind(this);
  this._onScrollbarDrag = this._onScrollbarDrag.bind(this);
  this._onScrollbarDragEnd = this._onScrollbarDragEnd.bind(this);
  this._onDetailBoxResizeStart = this._onDetailBoxResizeStart.bind(this);
  this._onDetailBoxResize = this._onDetailBoxResize.bind(this);
  this._onDetailBoxResizeStop = this._onDetailBoxResizeStop.bind(this);
  this._onFrameResizeStart = this._onFrameResizeStart.bind(this);
  this._onFrameResize = this._onFrameResize.bind(this);
  this._onFrameResizeEnd = this._onFrameResizeEnd.bind(this);
  this._onUnload = this._onUnload.bind(this);

  this._frame.addEventListener("load", this._onLoad, true);
  if (!this._iframe) {
    this._frame.setAttribute("src", "chrome://graphical-timeline/content/frontend/timeline.xul");
  }
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
    this._frameDoc.defaultView.focus();
    this.closeButton = this.$("close");
    this.recordButton = this.$("record");
    this.overviewButton = this.$("overview");
    this.detailBox = this.$("timeline-detailbox");
    this.producersPane = this.$("producers-pane");
    this.timeWindow = this.$("timeline-time-window");
    this.restartOnReload = this.$("restart-on-reload");
    this.canvasScrollbar = this.$("timeline-scrollbar");
    this.detailBox.setAttribute("visible", false);
    this.detailBox.setAttribute("pinned", false);
    // Attaching events.
    this._frameDoc.defaultView.onresize = this.onFrameResize;
    this.producersPane.onscroll = this.onProducersScroll;
    this.producersPane.addEventListener("DOMMouseScroll", this.onProducersMouseScroll, true);
    this.$("timeline-canvas-dots").addEventListener("MozMousePixelScroll", this.onCanvasScroll, true);
    this.$("timeline-canvas-dots").addEventListener("mousemove", this.handleMousemove, true);
    this.$("timeline-canvas-dots").addEventListener("mouseout", this.handleMouseout, true);
    this.$("stack-panes-splitter").addEventListener("mouseup", this.resizeCanvas, true);
    this.$("zoom-in").addEventListener("command", this.zoomIn, true);
    this.$("zoom-out").addEventListener("command", this.zoomOut, true);
    if (!this._iframe) {
      this.$("detailbox-closebutton").addEventListener("command", this.closeDetailBox, true);
      this.closeButton.addEventListener("command", Timeline.destroy, true);
    }
    else {
      this.closeButton.style.opacity = 0;
      this.closeButton.style.zIndex = -10;
      this.closeButton.style.pointerEvents = "none";
    }
    this.overviewButton.addEventListener("command", this.toggleOverview, true);
    this.recordButton.addEventListener("command", this.toggleRecording, true);
    this.restartOnReload.addEventListener("command", this.toggleRestartOnReload, true);
    this._frame.addEventListener("unload", this._onUnload, true);
    // Building the UI according to the preferences.
    this.overviewButton.setAttribute("checked", true);
    if (TimelinePreferences.doRestartOnReload == true) {
      this.restartOnReload.setAttribute("checked", true);
    }
    this.updateScrollbar();
    if (!this._iframe) {
      this.handleFrameResize();
    }
    // Setting up the first run experience
    if (TimelinePreferences.timesUIOpened == 0 ||
        TimelinePreferences.userStats.recorded == 0) {
      this.setupFirstRunExperience();
    }
    // Setting up general tips based on user stats.
    this.prepareTips();
    // Setup accesskey preview to show the access key for the various buttons
    this.setupAccesskeyPreview();
    TimelinePreferences.timesUIOpened = TimelinePreferences.timesUIOpened + 1;
  },

  /**
   * Adds first run messages to tell user some basic features of the UI.
   */
  setupFirstRunExperience: function TV_setupFirstRunExperience()
  {
    function onRecordingTipClick() {
      this.recordingTipButton.setAttribute("checked", true);
      this.recordButton.setAttribute("checked", true);
      this.recordingTip.classList.add("delayed-fade-out");
      this.recordingTip.style.MozAnimationDuration = "0.5s";
      this.recordingTipShown = false;
      this._window.setTimeout(function() {
        this.recordingTip.parentNode.removeChild(this.recordingTip);
        this.recordingTip = this.recordingTipButton = null;
        this.toggleRecording();
      }.bind(this), 500);
    }

    let recordingTip = this._frameDoc.createElement("hbox");
    recordingTip.setAttribute("class", "transparent-tip delayed-fade-in");
    let preText = this._frameDoc.createElement("label");
    preText.setAttribute("value", "Click here or the");
    let postText = this._frameDoc.createElement("label");
    postText.setAttribute("value", "record button to start recording events.");
    let recordingTipButton = this._frameDoc.createElement("toolbarbutton");
    recordingTipButton.setAttribute("class", "devtools-toolbarbutton record");
    let (spacer = this._frameDoc.createElement("spacer")) {
      spacer.setAttribute("flex", "1");
      recordingTip.appendChild(spacer);
    }
    let recordingTipContent = this._frameDoc.createElement("hbox");
    recordingTipContent.appendChild(preText);
    recordingTipContent.appendChild(recordingTipButton);
    recordingTipContent.appendChild(postText);
    recordingTipContent.setAttribute("class", "tip-content");
    recordingTip.appendChild(recordingTipContent);
    let (spacer = this._frameDoc.createElement("spacer")) {
      spacer.setAttribute("flex", "1");
      recordingTip.appendChild(spacer);
    }
    recordingTipContent.addEventListener("click", onRecordingTipClick.bind(this), true);

    this.detailBox.parentNode.appendChild(recordingTip);
    this.recordingTip = recordingTip;
    this.recordingTipButton = recordingTipButton;
    this.recordingTipShown = true;
  },

  /**
   * Adds general tips based on the user interaction with the timeline UI.
   */
  prepareTips: function TV_prepareTips()
  {
    let stats = TimelinePreferences.userStats;
    if (stats.windowZoomed == 0 && stats.recorded >= 2) {
      this.displayTips = function() {
        function onFrameClick() {
          this.$("timeline-canvas-dots").removeEventListener("click",
                                                             onFrameClick.bind(this), true);
          this.zoomingTip.classList.add("delayed-fade-out");
          this.zoomingTip.style.MozAnimationDuration = "0.5s";
          this._window.setTimeout(function() {
            this.zoomingTip.parentNode.removeChild(this.zoomingTip);
            this.zoomingTip = null;
          }.bind(this), 500);
        }

        this.zoomingTip = this._frameDoc.createElement("hbox");
        this.zoomingTip.setAttribute("class", "transparent-tip delayed-fade-in");
        let text = this._frameDoc.createElement("label");
        text.setAttribute("value", "Click and drag on this area to zoom into view");
        let (spacer = this._frameDoc.createElement("spacer")) {
          spacer.setAttribute("flex", "1");
          this.zoomingTip.appendChild(spacer);
        }
        let zoomingTipContent = this._frameDoc.createElement("hbox");
        zoomingTipContent.appendChild(text);
        zoomingTipContent.setAttribute("class", "tip-content");
        this.zoomingTip.appendChild(zoomingTipContent);
        let (spacer = this._frameDoc.createElement("spacer")) {
          spacer.setAttribute("flex", "1");
          this.zoomingTip.appendChild(spacer);
        }
        this.$("timeline-canvas-dots").addEventListener("mousedown",
                                                        onFrameClick.bind(this), true);

        this.detailBox.parentNode.appendChild(this.zoomingTip);
      };
    }
    else {
      this.displayTips = function() {};
    }
  },

  setupAccesskeyPreview: function TV_setupAccesskeyPreview()
  {
    this._frameDoc.addEventListener("keydown", this._onAltKeyDown.bind(this), true);
    this._frameDoc.addEventListener("keyup", this._onAltKeyUP.bind(this), true);
    this._frameDoc.addEventListener("keypress", this._onAltKeyUP.bind(this), true);
    this._frameDoc.addEventListener("mousedown", function() {
      this._frameDoc.defaultView.focus();
      this.clearAccessKeys();
    }.bind(this), true);
  },

  showAccessKeys: function TV_showAccessKeys()
  {
    this.recordButton.label = "R";
    this.overviewButton.label = "O";
    this.$("zoom-in").label = "+";
    this.$("zoom-out").label = "-";
    this._lastKeyPressTime = Date.now();
  },

  clearAccessKeys: function TV_clearAccessKeys()
  {
    try {
      this.recordButton.removeAttribute("label");
    } catch(ex) {}
    try {
      this.overviewButton.removeAttribute("label");
    } catch(ex) {}
    try {
      this.$("zoom-in").removeAttribute("label");
    } catch(ex) {}
    try {
      this.$("zoom-out").removeAttribute("label");
    } catch(ex) {}
  },

  _onAltKeyUP: function TV__onAltKeyUP(event)
  {
    if (event.keyCode == 18) {
      this.clearAccessKeys();
    }
  },

  _onAltKeyDown: function TV__onAltKeyPress(event)
  {
    if (event.keyCode == 18 && event.altKey) {
      this.showAccessKeys();
      event.stopPropagation();
      event.preventDefault();
      return;
    }
    if (!event.altKey) {
      return;
    }
    switch(event.keyCode) {
      case event.DOM_VK_R:
        this.recordButton.click();
        break;

      case event.DOM_VK_O:
        this.overviewButton.click();
        break;

      case event.DOM_VK_ADD:
      case event.DOM_VK_PLUS:
        this.$("zoom-in").click();
        break;

      case event.DOM_VK_SUBTRACT:
      case event.DOM_VK_HYPHEN_MINUS:
        this.$("zoom-out").click();
        break;

      default:
        return;
    }
    this.showAccessKeys();
    if (!this._accessKeysClearerTimer) {
      this._accessKeysClearerTimer =
        this._frameDoc.defaultView.setInterval(function() {
          if (Date.now() - this._lastKeyPressTime > 5000 && this._accessKeysClearerTimer) {
            this._frameDoc.defaultView.clearInterval(this._accessKeysClearerTimer);
            this._accessKeysClearerTimer = null;
            this.clearAccessKeys();
          }
        }.bind(this), 2000);
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
                      .indexOf(feature.getAttribute("value")) == -1) {
            feature.setAttribute("enabled", false);
          }
          else {
            enabledFeatures.push(id + ":" + feature.getAttribute("value"));
            feature.setAttribute("enabled", true);
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

  /**
   * Adds a label and vertical space for an event group.
   * Mainly used for continuous event types.
   *
   * @param |normalized event data| aData
   */
  addGroupBox: function TV_addGroupBox(aData)
  {
    let producerBox = this.$(aData.producer + "-box");
    if (!producerBox) {
      return;
    }
    let featureBox = producerBox.firstChild.nextSibling;
    let urlLabel = this._frameDoc.createElement("label");
    urlLabel.setAttribute("id", aData.groupID.replace(" ", "_") + "-groupbox");
    urlLabel.setAttribute("class", "timeline-groupbox");
    urlLabel.setAttribute("groupId", aData.groupID);
    urlLabel.setAttribute("shouldDelete", true);
    urlLabel.setAttribute("value", aData.name);
    urlLabel.setAttribute("tooltiptext", aData.nameTooltip || "");
    urlLabel.setAttribute("flex", "0");
    urlLabel.setAttribute("crop", "center");
    featureBox.appendChild(urlLabel);
    this._window.setTimeout(this.updateScrollbar, 100);
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
      this._frame.addEventListener("load", function tvCreatePane() {
        this._frame.removeEventListener("load", tvCreatePane, true);
        this.createProducersPane(aProducerInfoList);
      }.bind(this), true);
      return;
    }
    this.producerInfoList = aProducerInfoList;
    let XUL = "http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul";
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
        if (producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID ||
            producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START ||
            producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END) {
          this.continuousInLine = true;
        }
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
      let enableButton = this._frameDoc.createElement("checkbox");
      enableButton.setAttribute("class", "devtools-checkbox");
      if (TimelinePreferences.activeProducers.indexOf(producer.id) != -1) {
        enableButton.setAttribute("checked", true);
      }
      enableButton.addEventListener("command", this.toggleProducer, true);
      nameBox.appendChild(enableButton);
      let nameLabel = this._frameDoc.createElement("label");
      nameLabel.setAttribute("class", "producer-name-label");
      nameLabel.setAttribute("value", producer.name);
      nameBox.appendChild(nameLabel);
      let spacer = this._frameDoc.createElement("spacer");
      spacer.setAttribute("flex", "1");
      nameBox.appendChild(spacer);
      nameLabel.addEventListener("click", this.toggleProducerBox, true);
      spacer.addEventListener("click", this.toggleProducerBox, true);
      let optionDropDown = this._frameDoc.createElementNS(XUL, "toolbarbutton");
      optionDropDown.setAttribute("class", "producer-options-menu");
      optionDropDown.setAttribute("producerId", producer.id);
      optionDropDown.setAttribute("type", "checkbox");
      let optionsPopup = this._frameDoc.createElementNS(XUL, "menupopup");
      optionsPopup.setAttribute("producerId", producer.id);
      optionsPopup.setAttribute("id", producer.id + "-options-popup");
      optionsPopup.setAttribute("position", "after_start");
      optionsPopup.addEventListener("popuphiding", function() {
        optionDropDown.removeAttribute("checked");
      }, true);
      this.$("timeline-content").parentNode.appendChild(optionsPopup);
      nameBox.appendChild(optionDropDown);
      producerBox.appendChild(nameBox);

      // The features box contains list of each feature and a checkbox to toggle
      // that feature.
      let featureBox = this._frameDoc.createElement("vbox");
      featureBox.setAttribute("class", "producer-feature-box");
      featureBox.setAttribute("producerId", producer.id);
      featureBox.addEventListener("click", this.handleGroupClick, true);
      for each (let feature in producer.features) {
        let featureLabel = this._frameDoc.createElement("label");
        featureLabel.setAttribute("id", feature.replace(" ", "_") + "-groupbox");
        featureLabel.setAttribute("flex", "1");
        featureLabel.setAttribute("groupId", feature.replace(" ", "_"));
        featureLabel.setAttribute("class", "producer-feature");
        featureLabel.setAttribute("value", feature);
        if (TimelinePreferences.activeFeatures
                               .indexOf(producer.id + ":" + feature) == -1) {
          featureLabel.setAttribute("enabled", false);
        }
        else {
          featureLabel.setAttribute("enabled", true);
        }
        featureBox.appendChild(featureLabel);
        // Adding the checkbox in the options popup
        let featureCheckbox = this._frameDoc.createElement("menuitem");
        featureCheckbox.setAttribute("label", feature);
        featureCheckbox.setAttribute("type", "checkbox");
        featureCheckbox.setAttribute("groupId", feature.replace(" ", "_"));
        featureCheckbox.addEventListener("command", this.toggleFeature, true);
        if (TimelinePreferences.activeFeatures
                               .indexOf(producer.id + ":" + feature) == -1) {
          try {
            featureCheckbox.removeAttribute("checked");
          } catch (ex) {}
        }
        else {
          featureCheckbox.setAttribute("checked", true);
        }
        optionsPopup.appendChild(featureCheckbox);
      }
      if (!producer.features || producer.features.length == 0) {
        optionDropDown.setAttribute("tooltiptext", "No option to show");
        optionDropDown.setAttribute("disabled", true);
        optionsPopup.parentNode.removeChild(optionsPopup);
      }
      else {
        optionDropDown.addEventListener("command", function(event) {
          this.toggleOptionsForProducer(event, event.target.getAttribute("producerId"));
        }.bind(this), true);
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
    try {
      if (this.detailBox.lastChild.id == "detailbox-table") {
        this.detailBox.removeChild(this.detailBox.lastChild);
      }
    } catch (ex) {}
  },

  /**
   * Stops the timeline view to current time frame.
   */
  toggleMovement: function TV_toggleMovement()
  {
    if (!this._canvas.timeFrozen) {
      this._canvas.freezeCanvas();
      this.overviewButton.setAttribute("checked", true);
    }
    else {
      this._canvas.moveToCurrentTime();
    }
  },

  /**
   * Collapses the producer boxes at a threshold height to switch to the
   * comapct view and vice versa.
   */
  toggleCompactView: function TV_toggleCompactView()
  {
    if (this.producersPane.boxObject.height <= this.compactHeight &&
        this.compactMode == false) {
      this.compactMode = true;
      this.beforeCompactVisibleProducers = [];
      for each (let producer in this.producerInfoList) {
        let producerBox = this.$(producer.id + "-box");
        if (producerBox.getAttribute("visible") == "true") {
          this.beforeCompactVisibleProducers.push(producer.id);
        }
        producerBox.setAttribute("visible", false);
        if (producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID ||
            producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START ||
            producer.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END) {
          this.continuousInLine = true;
        }
      }
      if (this.canvasStarted) {
        this._frameDoc.defaultView.setTimeout(function() {
          let y={};
          this.producersPane.scrollBoxObject.getPosition({},y);
          this._canvas.offsetTop = y.value;
          this._canvas.updateGroupOffset();
          this._canvas.waitForLineData = false;
          this._canvas.waitForDotData = false;
          this._canvas.continuousInLine = this.continuousInLine;
          this.updateScrollbar();
        }.bind(this), 350);
      }
      let stats = TimelinePreferences.userStats;
      stats.compactMode++;
      TimelinePreferences.userStats = stats;
    }
    else if (this.producersPane.boxObject.height > this.compactHeight &&
             this.compactMode == true) {
      this.compactMode = false;
      for each (let producer in this.producerInfoList) {
        let producerBox = this.$(producer.id + "-box");
        if (this.beforeCompactVisibleProducers.indexOf(producer.id) != -1) {
          producerBox.setAttribute("visible", true);
        }
      }
      if (this.canvasStarted) {
        this._frameDoc.defaultView.setTimeout(function() {
          let y={};
          this.producersPane.scrollBoxObject.getPosition({},y);
          this._canvas.offsetTop = y.value;
          this._canvas.updateGroupOffset();
          this._canvas.waitForLineData = false;
          this._canvas.waitForDotData = false;
          this._canvas.continuousInLine = this.continuousInLine;
          this.updateScrollbar();
        }.bind(this), 350);
      }
    }
  },

  /**
   * Resize handler for the iframe.
   */
  onFrameResize: function TV_onFrameResize()
  {
    this.toggleCompactView();
    if (this.canvasStarted) {
      if (Math.abs(this.producersPane.clientHeight - this._canvas.height) > 5) {
        this._canvas.height = this.producersPane.boxObject.height;
        this.updateScrollbar();
      }
      if (Math.abs(this.$("canvas-container").boxObject.width - this._canvas.width) > 10) {
        this._canvas.width = this.$("canvas-container").boxObject.width -
                             (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
      }
    }
  },

  /**
   * Updates the height and vertical offset (style.top) for the scrollbar.
   *
   * @param boolean aPositionOnly
   *        true if you only want to update the vertical offset and do not want
   *        recalculate the height (used for better performance).
   */
  updateScrollbar: function TV_updateScrollbar(aPositionOnly)
  {
    let scrollHeight={}, y={};
    this.producersPane.scrollBoxObject.getScrolledSize({},scrollHeight);
    this.producersPane.scrollBoxObject.getPosition({},y);
    this.canvasScrollbar.style.right = (this.detailBoxOpened?
                                        this.detailBox.boxObject.width + 5:
                                        5) + "px";
    if (aPositionOnly) {
      this.canvasScrollbar.style.top =
        Math.floor(32 + y.value * this.scrollScale) + "px";
    }
    else if (scrollHeight.value > this.producersPane.boxObject.height) {
      this.canvasScrollbar.style.opacity = 1;
      let clientHeight = this._frame.height.replace("px", "")*1 - 32;
      let height = Math.floor(Math.max(20, clientHeight * clientHeight /
                                           scrollHeight.value));
      this.canvasScrollbar.style.height = (height - 2) + "px";
      this.scrollScale = (clientHeight - height) /
                         (scrollHeight.value + 2 - clientHeight);
      this.canvasScrollbar.style.top =
        Math.floor(32 + y.value * this.scrollScale) + "px";
    }
    else {
      this.canvasScrollbar.style.opacity = 0;
    }
  },

  /**
   * Starts and stops the listening of Data.
   */
  toggleRecording: function TV_toggleRecording()
  {
    if (!this.recording) {
      // removing the tip if displayed
      if (this.recordingTipShown) {
        this.recordingTipButton.setAttribute("checked", true);
        this.recordingTip.classList.add("delayed-fade-out");
        this.recordingTip.style.MozAnimationDuration = "0.25s";
        this.recordingTipShown = false;
        this._window.setTimeout(function() {
          this.recordingTip.parentNode.removeChild(this.recordingTip);
          this.recordingTip = this.recordingTipButton = null;
        }.bind(this), 250);
      }
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
            if (feature.getAttribute("enabled") == "true") {
              message.enabledProducers[id].features.push(feature.getAttribute("value"));
            }
            feature = feature.nextSibling;
          }
        }
      }
      this.cleanUI();
      Timeline.startListening(message);
      // Starting the canvas.
      if (!this.canvasStarted) {
        this._canvas = new CanvasManager(this._frameDoc, this._window);
        this._canvas.height = this.$("canvas-container").boxObject.height - 32;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             this.producersPane.boxObject.width -
                             (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
        this._canvas.continuousInLine = this.continuousInLine;
        this.canvasStarted = true;
        this.handleScroll();
        this.handleScrollbarMove();
        this.handleDetailClick();
        this.handleTimeWindow();
        this.handleDetailBoxResize();
      }
      else {
        this._canvas.height = this.$("canvas-container").boxObject.height - 32;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             this.producersPane.boxObject.width -
                             (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
        this._canvas.startRendering();
        if (!this.overviewButton.hasAttribute("checked")) {
          this._canvas.moveToLive();
          let stats = TimelinePreferences.userStats;
          stats.liveMode++;
          TimelinePreferences.userStats = stats;
        }
      }
      this.displayTips();
      let stats = TimelinePreferences.userStats;
      stats.recorded++;
      TimelinePreferences.userStats = stats;
    }
    else {
      this._canvas.stopRendering();
      Timeline.stopListening({timelineUIId: Timeline.id});
    }
    this.recording = !this.recording;
  },

  /**
   * Forcefully rstarts the canvas from time 0 forgetting about any pending events.
   */
  forceRestart: function TV_forceRestart()
  {
    this.cleanUI();
    this.recording = true;
    // Starting the canvas.
    if (!this.canvasStarted) {
      this._canvas = new CanvasManager(this._frameDoc, this._window);
      this._canvas.height = this.$("canvas-container").boxObject.height - 32;
      this._canvas.width = this.$("timeline-content").boxObject.width -
                           this.producersPane.boxObject.width -
                           (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
      this._canvas.continuousInLine = this.continuousInLine;
      this.canvasStarted = true;
      this.handleScroll();
      this.handleScrollbarMove();
      this.handleDetailClick();
      this.handleTimeWindow();
      this.handleDetailBoxResize();
    }
    else {
      this._canvas.height = this.$("canvas-container").boxObject.height - 32;
      this._canvas.width = this.$("timeline-content").boxObject.width -
                           this.producersPane.boxObject.width -
                           (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
      this._canvas.startRendering();
      if (!this.overviewButton.hasAttribute("checked")) {
        this._canvas.moveToLive();
        let stats = TimelinePreferences.userStats;
        stats.liveMode++;
        TimelinePreferences.userStats = stats;
      }
    }
  },

  /**
   * Click handler for the Overview button. Toggles the overview mode.
   */
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
      let stats = TimelinePreferences.userStats;
      stats.liveMode++;
      TimelinePreferences.userStats = stats;
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
    let target = aEvent.target;
    let linkedProducerId = target.parentNode.getAttribute("producerId");
    let feature = target.getAttribute("label");
    if (target.hasAttribute("checked")) {
      if (this.recording) {
        Timeline.enableFeatures(linkedProducerId, [feature]);
      }
      if (TimelinePreferences.activeFeatures
                             .indexOf(linkedProducerId + ":" + feature) == -1) {
        let activeFeatures = TimelinePreferences.activeFeatures;
        activeFeatures.push(linkedProducerId + ":" + feature);
        TimelinePreferences.activeFeatures = activeFeatures;
      }
      this.$(target.getAttribute("groupId") + "-groupbox").setAttribute("enabled", true);
    }
    else {
      if (this.recording) {
        Timeline.disableFeatures(linkedProducerId, [feature]);
      }
      if (TimelinePreferences.activeFeatures
                             .indexOf(linkedProducerId + ":" + feature) != -1) {
        let activeFeatures = TimelinePreferences.activeFeatures;
        activeFeatures.splice(activeFeatures.indexOf(linkedProducerId + ":" + feature), 1);
        TimelinePreferences.activeFeatures = activeFeatures;
      }
      this.$(target.getAttribute("groupId") + "-groupbox").setAttribute("enabled", false);
    }
    if (this.canvasStarted) {
      this._canvas.updateGroupOffset();
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
    if (this.canvasStarted) {
      this._frameDoc.defaultView.setTimeout(function() {
        let y={};
        this.producersPane.scrollBoxObject.getPosition({},y);
        this._canvas.offsetTop = y.value;
        this._canvas.updateGroupOffset();
        this._canvas.forcePaint = true;
        this.updateScrollbar();
      }.bind(this), 350);
    }
    if (!this.recording) {
      return;
    }
    let producerId = target.parentNode.getAttribute("producerId");
    if (target.hasAttribute("checked")) {
      let features = [];
      let featureBox = target.parentNode.parentNode.lastChild;
      let feature = featureBox.firstChild;
      while (feature) {
        if (feature.getAttribute("enabled") == "true") {
          features.push(feature.getAttribute("value"));
        }
        feature = feature.nextSibling;
      }
      Timeline.startProducer(producerId, features);
    }
    else {
      Timeline.stopProducer(producerId);
    }
  },

  /**
   * Click handler for the restart-on-reload checkbox.
   */
  toggleRestartOnReload: function TV_toggleRestartOnReload()
  {
    TimelinePreferences.doRestartOnReload = !TimelinePreferences.doRestartOnReload;
  },

  /**
   * Updates the canvas's width.
   */
  resizeCanvas: function TV_resizeCanvas()
  {
    if (this.canvasStarted) {
      this._canvas.width = this.$("timeline-content").boxObject.width -
        this.producersPane.boxObject.width -
        (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
    }
  },

  /**
   * Scroll handler on the producers pane. Updates the vertical offset of the
   * canvas so that the event name on the producers pane and the corresponding
   * dots/lines match up vertically.
   */
  onProducersScroll: function TV_onProducersScroll()
  {
    if (this.canvasStarted) {
      let y={};
      this.producersPane.scrollBoxObject.getPosition({},y);
      this._canvas.offsetTop = y.value;
    }
    this.updateScrollbar(true);
    this._canvas.waitForLineData = false;
    this._canvas.waitForDotData = false;
  },

  /**
   * This function prevents the default behaviors of an arrowscrollbox to
   * happen. ArrowScrollBox, upon a single tick of mouse wheel, scrolls to the
   * very end. This function makes a single tick to scroll only one line.
   */
  onProducersMouseScroll: function TV_onProducersMouseScroll(aEvent)
  {
    if (aEvent.detail) {
      aEvent.stopPropagation();
      aEvent.preventDefault();
      this.producersPane.scrollBoxObject.scrollByLine(aEvent.detail);
    }
  },

  /**
   * Scroll handler on the canvas. This function updates the vertical scroll
   * offset for the producers pane to vertically match up with the dots and lines.
   */
  onCanvasScroll: function TV_onCanvasScroll(aEvent)
  {
    if (aEvent.detail) {
      aEvent.preventDefault();
      this.producersPane.scrollBoxObject.scrollTo(0, Math.max(0, this._canvas.offsetTop + aEvent.detail));
      let y={};
      this.producersPane.scrollBoxObject.getPosition({},y);
      this._canvas.offsetTop = y.value;
      this._canvas.waitForLineData = false;
      this._canvas.waitForDotData = false;
    }
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
      this.continuousInLine = true;
    }
    else {
      producerBox.setAttribute("visible", true);
      this.continuousInLine = false;
    }
    if (this.canvasStarted) {
      this._frameDoc.defaultView.setTimeout(function() {
        let y={};
        this.producersPane.scrollBoxObject.getPosition({},y);
        this._canvas.offsetTop = y.value;
        this._canvas.updateGroupOffset();
        this._canvas.waitForLineData = false;
        this._canvas.waitForDotData = false;
        this._canvas.continuousInLine = this.continuousInLine;
        this.updateScrollbar();
      }.bind(this), 350);
    }
  },

  /**
   * Handles the click on the name of the event (if not a checkbox) and centers
   * the corresponding dot or line, opening the details pane alongside.
   */
  handleGroupClick: function TV_handleGroupClick(aEvent)
  {
    if (!this.canvasStarted) {
      return;
    }
    let group = aEvent.originalTarget;
    if (!group.hasAttribute("enabled") && group.hasAttribute("groupId")) {
      let groupId = group.getAttribute("groupId");
      let time = this._canvas.groupedData[groupId].timestamps[0];
      this._canvas.moveGroupInView(group.getAttribute("groupId"));
      this._canvas.displayDetailedData(this.width*0.45);
      this.showDetailedInfoFor([groupId], this._canvas.getGroupForTime(groupId, time));
      this._canvas.highlightGroup([groupId], this._canvas.getGroupForTime(groupId, time));
      this.detailBox.setAttribute("pinned", true);
      let width = this.$("timeline-content").boxObject.width -
            this.producersPane.boxObject.width -
            this.detailBox.boxObject.width;
      if (width < this._canvas.width) {
        this._canvas.scale = (this._canvas.lastVisibleTime -
                              this._canvas.firstVisibleTime) /
                             width;
        this._canvas.width = width;
        this.detailBoxOpened = true;
      }
    }
  },

  /**
   * Toggles the pinned status of the details pane.
   * If the details pane is not pinned, it acts as a floating box above the canvas.
   */
  pinUnpinDetailBox: function TV_pinUnpinDetailBox()
  {
    if (this.detailBox.getAttribute("pinned") == "false" &&
        this.detailBox.getAttribute("visible") == "true") {
      this.detailBox.setAttribute("pinned", true);
      let width = this.$("timeline-content").boxObject.width -
                  this.producersPane.boxObject.width -
                  this.detailBox.boxObject.width;
      if (width < this._canvas.width) {
        this._canvas.scale = (this._canvas.lastVisibleTime -
                              this._canvas.firstVisibleTime) /
                             width;
        this._canvas.width = width;
        this.detailBoxOpened = true;
      }
    }
  },

  /**
   * Click handler for the close button on the details pane. Closes it and moves
   * it away from the viewport.
   */
  closeDetailBox: function TV_closeDetailBox()
  {
    this.detailBox.setAttribute("visible", false);
    this.detailBox.setAttribute("pinned", false);
    this._canvas.width = this.$("timeline-content").boxObject.width -
                         this.producersPane.boxObject.width;
    this.detailBoxOpened = false;
    this.updateScrollbar();
    this._canvas.scale = (this._canvas.lastVisibleTime -
                          this._canvas.firstVisibleTime) /
                         this._canvas.width;
  },

  /**
   * Adds the event listener to toggle the pinned status of the details pane.
   */
  handleDetailClick: function TV_handleDetailClick()
  {
    this.$("timeline-highlighter").addEventListener("mousedown", this.pinUnpinDetailBox);
  },

  /**
   * Handles the mousemove on the canvas to highlight corresponding dots and
   * show their details.
   */
  handleMousemove: function TV_handleMousemove(aEvent)
  {
    if (this.canvasStarted) {
      let [groupIds, ids] = this._canvas
                                 .mouseHoverAt(aEvent.clientX -
                                               this.producersPane.boxObject.width,
                                               aEvent.clientY - 32);
      this.showDetailedInfoFor(groupIds, ids);
    }
  },

  /**
   * Mouse out handler on the canvas so as to stop displaying the time
   * corresponding to mouse location.
   */
  handleMouseout: function TV_handleMouseout(aEvent)
  {
    if (this.canvasStarted) {
      this._canvas.mousePointerAt = {x: 0, time: 0};
    }
  },

  /**
   * Toggles the options drop down menu popup for the corresponding producer.
   *
   * @param string aProducerId
   *        Id of the producer for which the popup is to be populated.
   */
  toggleOptionsForProducer: function TV_toggleOptionsForProducer(aEvent, aProducerId)
  {
    let popup = this.$(aProducerId + "-options-popup");
    if (popup.state == "open") {
      popup.hidePopup();
      return;
    }
    popup.openPopup(aEvent.target , "after_start");
    let producer = Timeline.producerInfoList[aProducerId];
    let featureCheckbox = popup.firstChild;
    while (featureCheckbox) {
      if (TimelinePreferences.activeFeatures.indexOf(
            aProducerId + ":" + featureCheckbox.getAttribute("label")) == -1) {
        try {
          featureCheckbox.removeAttribute("checked");
        } catch (ex) {}
      }
      else {
        featureCheckbox.setAttribute("checked", true);
      }
      featureCheckbox = featureCheckbox.nextSibling;
    }
  },

  /**
   * Opens a NetworkPanel for the network producer event.
   *
   * @param nsIDOMNode aNode
   *        The node you want the panel to be anchored to.
   * @param |Normalized Event Data| aData
   *        The data from which aHttpActivity would be build.
   */
  _showNetworkPanel: function TV__showNetworkPanel(aNode, aData)
  {
    let httpActivity = {
      log: {
        entries: [{
          startedDateTime: new Date(aData.details.startTime).toISOString(),
          request: aData.details.request,
          response: aData.details.response,
          timings: aData.details.timings
        }],
      },
      meta: {
        stages: aData.details.stages,
      }
    };
    // Adding cookie entry as null
    httpActivity.log.entries[0].response.cookies = [];
    httpActivity.log.entries[0].request.cookies = [];
    let netPanel = new NetworkPanel(this.$("timeline-content").parentNode, httpActivity);

    let panel = netPanel.panel;
    panel.openPopup(aNode, "after_pointer", 0, 0, false, false);
    panel.sizeTo(450, 500);
    let stats = TimelinePreferences.userStats;
    stats.networkPanel++;
    TimelinePreferences.userStats = stats;
  },

  /**
   * Populates the details pane with the information of the event corresponding
   * to the geoup id and data id provided.
   *
   * @param [string] aGroupIds
   *        List of group ids. While only the first id would be chosen.
   * @param [string] aIds
   *        List of data ids corresponding to the group ids. While only the most
   *        relevant data id would be chosen to display.
   */
  showDetailedInfoFor: function TV_showDetailedInfoFor(aGroupIds, aIds)
  {
    if (!aIds || aIds.length == 0) {
      return;
    }
    let id = aIds[aIds.length - 1];
    if (this.detailBox.hasAttribute("dataId") && this.detailBox.getAttribute("dataId") == id) {
      return;
    }
    this.detailBox.setAttribute("dataId", id);
    if (this.detailBox.hasAttribute("groupId")) {
      try {
        this._frameDoc.getElementById(this.detailBox.getAttribute("groupId")).blur();
      } catch (ex) {}
      this.detailBox.removeAttribute("groupId");
    }
    if (aGroupIds && aGroupIds.length == 1) {
      this.detailBox.setAttribute("groupId", aGroupIds[0] + "-groupbox");
      try {
        this._frameDoc.getElementById(aGroupIds[0] + "-groupbox").focus();
      } catch(ex) {}
    }
    try {
      if (this.detailBox.lastChild.id == "detailbox-table") {
        this.detailBox.removeChild(this.detailBox.lastChild);
      }
    } catch (ex) {}
    /* Hard coded starts */
    if (Timeline.data[id].producer == "NetworkProducer") {
      let more = this.$("detailbox-closebutton").previousSibling;
      more.collapsed = false;
      more.onclick = this._showNetworkPanel.bind(this, more, Timeline.data[id]);
    }
    else {
      this.$("detailbox-closebutton").previousSibling.collapsed = true;
    }
    /* Hard coded ends */
    let table = this._frameDoc.createElementNS(HTML, "table");
    table.setAttribute("id", "detailbox-table");
    let topCell = this._frameDoc.createElementNS(HTML, "th");
    topCell.setAttribute("class", "property-heading");
    topCell.setAttribute("colspan", 2);
    topCell.textContent = this.producerInfoList[Timeline.data[id].producer].name;
    let row = this._frameDoc.createElementNS(HTML, "tr");
    row.appendChild(topCell)
    table.appendChild(row);
    this.detailBox.appendChild(table);
    if (Timeline.data[id].details) {
      for (let property in this.producerInfoList[Timeline.data[id].producer]
                               .details) {
        if (Timeline.data[id].details[property] == null){
          continue;
        }
        if (this.producerInfoList[Timeline.data[id].producer]
                .details[property].type != "nested") {
          let {name:name, valueLabel:valueLabel} =
            this.getPropertyInfo(Timeline.data[id].producer,
                                 property,
                                 Timeline.data[id].details[property]);
          let propRow = this._frameDoc.createElementNS(HTML, "tr");
          let nameLabel = this._frameDoc.createElement("label");
          nameLabel.setAttribute("value", name + " :");
          valueLabel.setAttribute("crop", "end");
          let (td = this._frameDoc.createElementNS(HTML, "td")) {
            td.appendChild(nameLabel);
            propRow.appendChild(td);
          }
          let (td = this._frameDoc.createElementNS(HTML, "td")) {
            td.appendChild(valueLabel);
            propRow.appendChild(td);
          }
          propRow.setAttribute("class", "property-line");
          table.appendChild(propRow);
        }
        else {
          let headingRow = this._frameDoc.createElementNS(HTML, "tr");
          let headingCell = this._frameDoc.createElementNS(HTML, "td");
          let headingLabel = this._frameDoc.createElement("label");
          headingLabel.setAttribute("value", this.producerInfoList[
                                               Timeline.data[id].producer
                                             ].details[property].name);
          headingCell.appendChild(headingLabel);
          headingCell.setAttribute("colspan", 2);
          headingCell.setAttribute("class", "detailed-heading");
          headingRow.appendChild(headingCell);
          table.appendChild(headingRow);
          let anythingPresent = false;
          for (let subProp in this.producerInfoList[
                                Timeline.data[id].producer
                              ].details[property].items) {
            if (Timeline.data[id].details[property][subProp] == null){
              continue;
            }
            anythingPresent = true;
            let {name:name, valueLabel:valueLabel} =
              this.getPropertyInfo(Timeline.data[id].producer,
                                   property,
                                   Timeline.data[id].details[property][subProp],
                                   subProp);
            let propRow = this._frameDoc.createElementNS(HTML, "tr");
            let nameLabel = this._frameDoc.createElement("label");
            nameLabel.setAttribute("value", name + " :");
            valueLabel.setAttribute("crop", "end");
            let (td = this._frameDoc.createElementNS(HTML, "td")) {
              td.appendChild(nameLabel);
              propRow.appendChild(td);
            }
            let (td = this._frameDoc.createElementNS(HTML, "td")) {
              td.appendChild(valueLabel);
              propRow.appendChild(td);
            }
            propRow.setAttribute("class", "detailed-property-line");
            table.appendChild(propRow);
          }
          if (!anythingPresent) {
            table.removeChild(headingRow);
          }
        }
      }
    }
    this.$("detailbox-splitter").style.height = Math.max(this.detailBox.boxObject.height,
                                                         table.scrollHeight) + "px";
  },

  /**
   * Creates an overlapping pane to show the JSON in a tabular form.
   *
   *   <vbox id="timeline-property-detail" class="absolute">
   *     <hbox id="property-detail-button-container">
   *       <hbox>
   *         <label class="detail-levels" />
   *       </hbox>
   *       <spacer flex="1" />
   *       <toolbarbutton id="property-detail-closebutton"
   *                      class="devtools-closebutton"
   *                      tooltiptext="&timelineUI.closeButton.tooltip;" />
   *     </hbox>
   *     <html:table />
   *   </vbox>
   *
   * @param object aProperty
   *        { name, value} : the name and value of the property.
   * @param [string] aLevels
   *        The level heirarchy of the detail view.
   */
  createNextLevelJSONView: function TV_createNextLevelJSONView(aProperty, aLevels)
  {
    // Building the initial XUL
    let propertyDetailBox = this._frameDoc.createElement("vbox");
    propertyDetailBox.setAttribute("class", "absolute timeline-property-detail");
    propertyDetailBox.style.width = (this.detailBox.boxObject.width - 10) + "px";
    let hbox = this._frameDoc.createElement("hbox");
    hbox.setAttribute("class", "property-detail-button-container");
    let labelHBox = this._frameDoc.createElement("hbox");
    labelHBox.setAttribute("flex", 1);
    let close = this._frameDoc.createElement("toolbarbutton");
    close.setAttribute("class", "devtools-closebutton");
    close.setAttribute("tooltiptext", "Close");
    hbox.appendChild(labelHBox);
    hbox.appendChild(close);
    let table = this._frameDoc.createElementNS(HTML, "table");
    propertyDetailBox.appendChild(hbox);
    propertyDetailBox.appendChild(table);
    //Filling up the level labels
    for each (let level in aLevels) {
      let levelLabel = this._frameDoc.createElement("label");
      levelLabel.setAttribute("class", "level-label");
      levelLabel.setAttribute("value", level + " > ");
      labelHBox.appendChild(levelLabel);
    }
    // Building up the table.
    // Converting the object string to an object
    let anythingPresent = false;
    for each (let object in aProperty.value) {
      let headingRow = this._frameDoc.createElementNS(HTML, "tr");
      let headingCell = this._frameDoc.createElementNS(HTML, "td");
      let bracketStart = this._frameDoc.createElement("label");
      bracketStart.setAttribute("value", "{");
      headingCell.appendChild(bracketStart);
      headingCell.setAttribute("colspan", 2);
      headingCell.setAttribute("class", "detailed-heading");
      headingRow.appendChild(headingCell);
      table.appendChild(headingRow);
      anythingPresent = true;
      for (let property in object) {
        let propRow = this._frameDoc.createElementNS(HTML, "tr");
        let nameLabel = this._frameDoc.createElement("label");
        let valueLabel = this._frameDoc.createElement("label");
        nameLabel.setAttribute("value", property + " :");
        valueLabel.setAttribute("crop", "end");
        if (typeof object[property] != "object") {
          valueLabel.setAttribute("value", object[property]);
          valueLabel.setAttribute("tooltiptext", object[property]);
        }
        else {
          valueLabel.setAttribute("value", "Click to View");
          valueLabel.setAttribute("class", "text-link");
          aLevels.push(property);
          valueLabel.addEventListener("click", this.createNextLevelJSONView
                                                   .bind(this,
                                                         {name: property, value: object[property]},
                                                         aLevels
                                                        ), true);
        }
        let (td = this._frameDoc.createElementNS(HTML, "td")) {
          td.appendChild(nameLabel);
          propRow.appendChild(td);
        }
        let (td = this._frameDoc.createElementNS(HTML, "td")) {
          td.appendChild(valueLabel);
          propRow.appendChild(td);
        }
        propRow.setAttribute("class", "detailed-property-line");
        table.appendChild(propRow);
      }
      let endRow = this._frameDoc.createElementNS(HTML, "tr");
      let endCell = this._frameDoc.createElementNS(HTML, "td");
      let bracketEnd = this._frameDoc.createElement("label");
      bracketEnd.setAttribute("value", "}");
      endCell.appendChild(bracketEnd);
      endCell.setAttribute("colspan", 2);
      endCell.setAttribute("class", "detailed-heading");
      endRow.appendChild(endCell);
      table.appendChild(endRow);
    }
    if (!anythingPresent) {
      let headingRow = this._frameDoc.createElementNS(HTML, "tr");
      let headingCell = this._frameDoc.createElementNS(HTML, "td");
      let emptyLabel = this._frameDoc.createElement("label");
      emptyLabel.setAttribute("value", "Nothing to see here");
      headingCell.appendChild(emptyLabel);
      headingCell.setAttribute("class", "detailed-heading");
      headingRow.appendChild(headingCell);
      table.appendChild(headingRow);
    }
    // Attaching the event listener to the close button.
    close.addEventListener("command", this.closePropertyDetailBox.bind(this, propertyDetailBox), true);
    propertyDetailBox.setAttribute("visible", true);
    this.detailBox.parentNode.insertBefore(propertyDetailBox, this.detailBox.nextSibling);
  },

  closePropertyDetailBox: function TV_closePropertyDetialBox(aPropertyDetailBox)
  {
    aPropertyDetailBox.setAttribute("visible", false);
    this._window.setTimeout(function() {
      aPropertyDetailBox.parentNode.removeChild(aPropertyDetailBox);
    }, 5000);
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
   * @return {name: _name_, value: _value_, valueLabel: _valueLabel_}
   *         _name_ is the display name, _value_ is the display value,
   *         _valueLabel_ is the XUL element representing the value.
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
      name = details[aName].name;
      let valueLabel = this._frameDoc.createElement("label");
      switch (type) {
        case "string":
        case "number":
          value = aValue;
          valueLabel.setAttribute("value", aValue);
          break;

        case "date":
          let date = new Date(aValue);
          value = "+" + this.getScaledTime(aValue - this._canvas.startTime);
          valueLabel.setAttribute("value", value);
          valueLabel.setAttribute("tooltiptext", date.toLocaleString()
            .replace(/\s([ap]m)/i, "." + date.getMilliseconds() + " " + "$1"));
          break;

        case "enum":
          value = details[aName].values[aValue] || "null";
          valueLabel.setAttribute("value", value);
          break;

        case "ms":
          value = (aValue || "0") + " ms";
          valueLabel.setAttribute("value", value);
          break;

        case "s":
          value = (aValue || "0") + " s";
          valueLabel.setAttribute("value", value);
          break;

        case "px":
          value = (aValue || "0") + " px";
          valueLabel.setAttribute("value", value);
          break;

        case "id":
          value = aValue;
          valueLabel.setAttribute("value", value);
          valueLabel.setAttribute("class", "text-link");
          if (aValue != null) {
            valueLabel.addEventListener("click", function() {
              try {
                this._window.InspectorUI
                    .openInspectorUI(this._window.gBrowser.contentDocument
                                         .getElementById(value));
              } catch (ex) {
                if (Timeline._toolbox) {
                  Timeline._toolbox.selectTool("inspector").then(function(panel) {
                    panel.selection.setNode(Timeline._toolbox._target.tab
                                                    .linkedBrowser
                                                    .contentDocument
                                                    .getElementById(value), "timeline");
                  });
                }
              }
              let stats = TimelinePreferences.userStats;
              stats.inspector++;
              TimelinePreferences.userStats = stats;
            }.bind(this), true);
          }
          break;

        case "url":
          value = aValue;
          if (value.length > 20) {
            let trimmedURL = aValue.match(/^[^?#&]+/)[0].length;
            let lastSlash = aValue.lastIndexOf("/", trimmedURL);
            value = value.substring(lastSlash + 1, trimmedURL);
            if (value.length == 0) {
              value = aValue;
            }
          }
          if (aValue.length > 0) {
            valueLabel.setAttribute("class", "text-link");
            let extension = value.split(".");
            if (extension && extension.length > 1) {
              extension = extension[extension.length - 1];
              switch (extension) {
                case "css":
                  valueLabel.addEventListener("click", function() {
                    
                    try {
                      let styleSheets = this._window.content.window.document.styleSheets;
                      for each (let style in styleSheets) {
                        if (style.href == aValue) {
                          try {
                          this._window.StyleEditor.openChrome(style, 1);
                          } catch (ex) {
                            if (Timeline._toolbox) {
                              Timeline._toolbox.selectTool("styleeditor").then(function(panel) {
                                panel.selectStyleSheet(style, 1);
                              });
                              return;
                            }
                          }
                          return;
                        }
                      }
                    } catch (ex) {}
                    this._window.openUILinkIn(aValue, "tab");
                    let stats = TimelinePreferences.userStats;
                    stats.linkClicked++;
                    TimelinePreferences.userStats = stats;
                  }.bind(this));
                  break;

                case "js":
                  valueLabel.addEventListener("click", function() {
                    let window = this._window;
                    let stats = TimelinePreferences.userStats;
                    stats.linkClicked++;
                    TimelinePreferences.userStats = stats;
                    if (!Timeline._toolbox) {
                      function openScript(scriptsView) {
                        let targetScript = aValue;
                        let scriptLocations = scriptsView.scriptLocations;

                        if (scriptLocations.indexOf(targetScript) === -1) {
                          window.DebuggerUI.toggleDebugger();
                          window.openUILinkIn(aValue, "tab");
                          window = null;
                          return;
                        }
                        scriptsView.selectScript(targetScript);
                        window = null;
                      }
                      if (window.DebuggerUI.getDebugger() == null) {
                        window.DebuggerUI.toggleDebugger();
                        let dbg = window.DebuggerUI.getDebugger().contentWindow;

                        dbg.addEventListener("Debugger:Connecting", function onConnecting() {
                          dbg.removeEventListener("Debugger:Connecting", onConnecting);

                          let client = dbg.DebuggerController.client;
                          let scripts = dbg.DebuggerView.Scripts;

                          client.addOneTimeListener("resumed", openScript.bind(this, scripts));
                        });
                      }
                      else {
                        let dbg = window.DebuggerUI.getDebugger().contentWindow;
                        let client = dbg.DebuggerController.client;
                        let scripts = dbg.DebuggerView.Scripts;
                        openScript(scripts);
                      }
                    } else {
                      Timeline._toolbox.selectTool("jsdebugger").then(function(dbg) {
                        dbg.panelWin.DebuggerView.Sources.preferredSource = aValue;
                      });
                    }
                  }.bind(this))
                  break;

                default:
                  valueLabel.addEventListener("click", function() {
                    this._window.openUILinkIn(aValue, "tab");
                    let stats = TimelinePreferences.userStats;
                    stats.linkClicked++;
                    TimelinePreferences.userStats = stats;
                  }.bind(this));
              }
            }
            else {
              valueLabel.setAttribute("href", aValue);
            }
          }
          valueLabel.setAttribute("value", value);
          valueLabel.setAttribute("tooltiptext", aValue);
          break;

        case "object":
          value = aValue;
          valueLabel.setAttribute("value", "Click to View");
          //valueLabel.setAttribute("tooltiptext", JSON.stringify(value));
          valueLabel.setAttribute("class", "text-link");
          valueLabel.addEventListener("click", this.createNextLevelJSONView
                                                   .bind(this,
                                                         {name: name, value: value},
                                                         [name]
                                                        ), true);
          break;

        case "rect":
          value = "rect(" + aValue.left.toFixed(1) + ", " + aValue.top.toFixed(1) +
                  ", " + aValue.width.toFixed(1) + ", " + aValue.height.toFixed(1) + ")";
          valueLabel.setAttribute("value", value);
          break;

        default:
          return null;
      }
      return {name: name, value: value, valueLabel: valueLabel};
    }
    return null;
  },

  /**
   * Returns sotring for a time duration.
   *
   * @param aTime number
   *        Duration in milli seconds.
   *
   * @return string
   *         Formatted strings like '1h34m10s'
  */
  getScaledTime: function TV_getScaledTime(aTime)
  {
    aTime = Math.round(aTime);
    if (aTime > 3600000) {
      let seconds = Math.round(aTime/1000);
      let minutes = Math.floor(seconds/60);
      return Math.floor(minutes/60) + " h" +
             (minutes%60 > 0?(" " + minutes%60 + " m"):"") +
             (seconds > 0? " " + seconds + " s":"");
    }
    else if (aTime > 60000) {
      let seconds = Math.round(aTime/1000);
      let minutes = Math.floor(seconds/60);
      return minutes + " m" + (seconds > 0? " " + seconds + " s":"");
    }
    else if (aTime > 10000) {
      let seconds = Math.floor(aTime/1000);
      return seconds + " s" + (aTime%1000 > 0? " " + aTime%1000 + " ms":"");
    }
    else {
      return aTime + " ms";
    }
  },

  /**
   * Checks whether a label for the group id is there or not.
   *
   * @param |normalized event data| aData
   *
   * @return boolean true if the label is present.
   */
  hasGroup: function TV_hasGroup(aData)
  {
    let groupBox = null;
    switch (aData.type) {
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_MID:
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START:
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_STOP:
        groupBox = this._frameDoc.getElementById(aData.name.replace(" ", "_") + "-groupbox");
        break;

      default:
        groupBox = this._frameDoc.getElementById(aData.groupID + "-groupbox");
    }

    if (groupBox && groupBox.parentNode.getAttribute("producerId") == aData.producer) {
      return true;
    }
    else {
      return false;
    }
  },

  /**
   * Alias function used by zoom in and out to zoom in and out of the canvas.
   *
   * @param boolean aZoomIn
   *        true if you want to zoom in to the canvas.
   */
  zoom: function TV_zoom(aZoomIn)
  {
    if (this.canvasStarted) {
      this._canvas.zoomBy(aZoomIn?20:-20);
    }
  },

  /**
   * Gets the data and sends it to the canvas to display
   *
   * @param object aData
   *        Normalized event data.
   */
  displayData: function TV_displayData(aData)
  {
    let id = this._canvas.pushData(aData);
    if (id != null) {
      if (!this.hasGroup(aData)) {
        this.addGroupBox(aData);
        this._canvas.updateGroupOffset();
      }
    }
  },

  _onScrollbarDragStart: function TV__onScrollbarDragStart(aEvent)
  {
    this.scrollStartY = aEvent.clientY;
    this.originalScrollbarTop = this.canvasScrollbar.style.top.replace("px","")*1 - 32;
    this.canvasScrollbar.removeEventListener("mousedown", this._onScrollbarDragStart, true);
    this.$("canvas-container").addEventListener("mousemove", this._onScrollbarDrag, true);
    this._frameDoc.addEventListener("mouseup", this._onScrollbarDragEnd, true);
    this._frameDoc.addEventListener("click", this._onScrollbarDragEnd, true);
  },

  _onScrollbarDrag: function TV__onScrollbarDrag(aEvent)
  {
    this.producersPane.scrollBoxObject
        .scrollTo(0, Math.max(0, (this.originalScrollbarTop + aEvent.clientY -
                                  this.scrollStartY) / this.scrollScale));
    let y={};
    this.producersPane.scrollBoxObject.getPosition({},y);
    this._canvas.offsetTop = y.value;
  },

  _onScrollbarDragEnd: function TV__onScrollbarDragEnd(aEvent)
  {
    this.$("canvas-container").removeEventListener("mousemove", this._onScrollbarDrag, true);
    this._frameDoc.removeEventListener("mouseup", this._onScrollbarDragEnd, true);
    this._frameDoc.removeEventListener("click", this._onScrollbarDragEnd, true);
    this.handleScrollbarMove();
  },

  /**
   * Handles dragging of the scrollbar on the canvas.
   */
  handleScrollbarMove: function TV_handleScrollbarMove()
  {
    this.canvasScrollbar.addEventListener("mousedown", this._onScrollbarDragStart, true);
  },

  _onDragStart: function TV__onDragStart(aEvent)
  {
    this.scrollStartX = aEvent.clientX;
    this.$("timeline-canvas-overlay").removeEventListener("mousedown", this._onDragStart, true);
    if (!this._canvas.timeFrozen) {
      this._canvas.freezeCanvas();
    }
    this._canvas.startScrolling();
    this.$("canvas-container").addEventListener("mousemove", this._onDrag, true);
    this._frameDoc.addEventListener("mouseup", this._onDragEnd, true);
    this._frameDoc.addEventListener("click", this._onDragEnd, true);
    let stats = TimelinePreferences.userStats;
    stats.rulerDragged++;
    TimelinePreferences.userStats = stats;
  },

  _onDrag: function TV__onDrag(aEvent)
  {
    this._canvas.scrollDistance = aEvent.clientX - this.scrollStartX;
  },

  _onDragEnd: function TV__onDragEnd(aEvent)
  {
    this._canvas.stopScrolling();
    this.$("canvas-container").removeEventListener("mousemove", this._onDrag, true);
    this._frameDoc.removeEventListener("mouseup", this._onDragEnd, true);
    this._frameDoc.removeEventListener("click", this._onDragEnd, true);
    this.handleScroll();
  },

  /**
   * Handles dragging of the ruler to scroll to previous time.
   */
  handleScroll: function TV_handleScroll()
  {
    this.$("timeline-canvas-overlay").addEventListener("mousedown", this._onDragStart, true);
  },

  _onDetailBoxResizeStart: function TV__onDetailBoxResizeStart(aEvent)
  {
    this.resizeStartX = aEvent.clientX;
    this.originalDetailBoxWidth = this.detailBox.boxObject.width;
    this.$("detailbox-splitter").removeEventListener("mousedown", this._onDetailBoxResizeStart, true);
    this._frameDoc.addEventListener("mousemove", this._onDetailBoxResize, true);
    this._frameDoc.addEventListener("mouseup", this._onDetailBoxResizeStop, true);
    this._frameDoc.addEventListener("click", this._onDetailBoxResizeStop, true);
  },

  _onDetailBoxResize: function TV__onDetailBoxResize(aEvent)
  {
    this.detailBox.style.width = (this.originalDetailBoxWidth + this.resizeStartX -
                                  aEvent.clientX) + "px"
  },

  _onDetailBoxResizeStop: function TV__onDetailBoxResizeStop(aEvent)
  {
    this._frameDoc.removeEventListener("mousemove", this._onDetailBoxResize, true);
    this._frameDoc.removeEventListener("mouseup", this._onDetailBoxResizeStop, true);
    this._frameDoc.removeEventListener("click", this._onDetailBoxResizeStop, true);
    this._canvas.width = this.$("canvas-container").boxObject.width -
                         (this.detailBoxOpened? this.detailBox.boxObject.width: 0);
    this.updateScrollbar();
    this.handleDetailBoxResize();
  },

  /**
   * Handles dragging of the detailbox splitter.
   */
  handleDetailBoxResize: function TV_handleDetailBoxResize()
  {
    this.$("detailbox-splitter").addEventListener("mousedown", this._onDetailBoxResizeStart, true);
  },

  _onWindowStart: function TV__onWindowStart(aEvent)
  {
    this.$("timeline-canvas-dots").removeEventListener("mousedown", this._onWindowStart, true);
    this.timeWindow.setAttribute("selecting", true);
    let left = aEvent.clientX - this.producersPane.boxObject.width;
    this.timeWindow.style.right = this.timeWindow.style.left = left + "px";
    this.timeWindow.style.width = "0px";
    this.$("canvas-container").addEventListener("mousemove", this._onWindowSelect, true);
    this._frameDoc.addEventListener("mouseup", this._onWindowEnd, true);
    this._frameDoc.addEventListener("click", this._onWindowEnd, true);
    this._canvas.startTimeWindowAt(left);
    this._windowZoomTimeout = this._window.setTimeout(function() {
      this.$("canvas-container").style.cursor = "e-resize";
    }.bind(this), 500);
  },

  _onWindowSelect: function TV__onWindowSelect(aEvent)
  {
    if (this._windowZoomTimeout) {
      this._window.clearTimeout(this._windowZoomTimeout);
      this.$("canvas-container").style.cursor = "e-resize";
      this._windowZoomTimeout = null;
    }
    this.timeWindow.style.width = (aEvent.clientX -
      this.producersPane.boxObject.width -
      this.timeWindow.style.left.replace("px", "")*1) + "px";
  },

  _onWindowEnd: function TV__onWindowEnd(aEvent)
  {
    this.$("canvas-container").removeEventListener("mousemove", this._onWindowSelect, true);
    this._frameDoc.removeEventListener("mouseup", this._onWindowEnd, true);
    this._frameDoc.removeEventListener("click", this._onWindowEnd, true);
    let zoomed = this._canvas.stopTimeWindowAt(aEvent.clientX -
                  this.producersPane.boxObject.width);
    try {
      this.timeWindow.removeAttribute("selecting");
    } catch (ex) {}
    if (zoomed) {
      this.timeWindow.setAttribute("selected", true);
      let stats = TimelinePreferences.userStats;
      stats.windowZoomed++;
      TimelinePreferences.userStats = stats;
      this._frameDoc.defaultView.setTimeout(function() {
        this.timeWindow.removeAttribute("selected");
      }.bind(this), 500);
    }
    if (this._windowZoomTimeout) {
      this._window.clearTimeout(this._windowZoomTimeout);
      this._windowZoomTimeout = null;
    }
    this.$("canvas-container").style.cursor = "default";
    this.handleTimeWindow();
  },

  /**
   * Handles dragging of the time window line to select a time range.
   */
  handleTimeWindow: function TV_handleTimeWindow()
  {
    this.$("timeline-canvas-dots").addEventListener("mousedown", this._onWindowStart, true);
  },

  _onFrameResizeStart: function TV__onFrameResizeStart(aEvent)
  {
    this._splitter.removeEventListener("mousedown", this._onFrameResizeStart, true);
    this._splitter.style.position = "fixed";
    this._splitter.style.display = "block";
    this._splitter.style.width = "100%";
    this._splitter.style.height = "7px";
    this._splitter.style.background = "-moz-linear-gradient(top, transparent 0px," +
                                      "transparent 2px, rgb(22,33,43) 2px, rgb(22,33,43) 3px," +
                                      "white 3px, white 4px, rgb(22,33,43) 4px," +
                                      "rgb(22,33,43) 5px, transparent 5px, transparent 7px)";
    this._splitter.style.backgroundOrigin = "border-box";
    this._splitter.style.top = (aEvent.screenY - this._window.screenY - 2) + "px";
    this._window.addEventListener("mousemove", this._onFrameResize, true);
    this._window.addEventListener("mouseup", this._onFrameResizeEnd, true);
    this._frameResizeStartY = aEvent.screenY;
  },

  _onFrameResize: function TV__onFrameResize(aEvent)
  {
    this._splitter.style.top = (aEvent.screenY - this._window.screenY - 2) + "px";
  },

  _onFrameResizeEnd: function TV__onFrameResizeEnd(aEvent)
  {
    this._splitter.style.position = "absolute";
    this._splitter.style.height = "3px";
    this._splitter.style.top = (aEvent.screenY - this._window.screenY - 2) + "px";
    this._frame.style.height = this._frame.height =
      (this._frame.height.replace("px", "")*1 +
       this._frameResizeStartY - aEvent.screenY) + "px";
    this._splitter.style.border = "none";
    this._splitter.style.background = "transparent";
    this._window.removeEventListener("mousemove", this._onFrameResize, true);
    this._window.removeEventListener("mouseup", this._onFrameResizeEnd, true);
    this.handleFrameResize();
  },

  handleFrameResize: function TV_handleFrameResize()
  {
    this._splitter.addEventListener("mousedown", this._onFrameResizeStart, true);
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
    TimelinePreferences.compactMode = this.compactMode;
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
        if (feature.getAttribute("enabled") == "true") {
          activeFeatures.push(id + ":" + feature.getAttribute("value"));
        }
        feature = feature.nextSibling;
      }
    }
    TimelinePreferences.visibleProducers = visibleProducers;
    TimelinePreferences.activeFeatures = activeFeatures;
    TimelinePreferences.activeProducers = activeProducers;

    // Removing frame and splitter.
    if (this.canvasStarted) {
      this._canvas.destroy();
      this._canvas = null;
    }
    if (!this._iframe) {
      this._splitter.parentNode.removeChild(this._splitter);
      this._frame.parentNode.removeChild(this._frame);
      this._frame = null;
    }
    this._frameDoc = this._window = null;
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
  _iframe: null,
  _toolbox: null,
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
  init: function GUI_init(aCallback, aIframe, aToolbox) {
    Cu.import("chrome://graphical-timeline/content/frontend/timeline-canvas.jsm");
    Timeline.callback = aCallback;
    if (aIframe) {
      Timeline._iframe = aIframe;
    }
    Timeline._toolbox = aToolbox;
    if (Timeline._toolbox) {
      Timeline._window = Timeline._toolbox._target.tab.ownerDocument.defaultView;
    }
    else {
      Timeline._window = Services.wm.getMostRecentWindow("navigator:browser");
    }
    Timeline.addRemoteListener(Timeline._window);
    // destroying on unload.
    Timeline._window.addEventListener("unload", Timeline.destroy, false);
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
      Timeline._view = new TimelineView(Timeline._window, Timeline._iframe);
    }
    Timeline._view.createProducersPane(Timeline.producerInfoList);
    Timeline.UIOpened = true;
  },

  /**
   * Starts the Data Sink and all the producers.
   */
  startListening: function GUI_startListening(aMessage) {
    //Timeline.timer = Timeline._window.setInterval(Timeline.readData, 25);
    // Adding the correct tab id, if toolbox is available.
    if (Timeline._toolbox) {
      aMessage.tabID = Timeline._toolbox._target.tab.linkedPanel;
    }
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

      case DataSinkEventMessageType.PAGE_RELOAD:
        if (TimelinePreferences.doRestartOnReload) {
          Timeline._view.forceRestart();
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
    if (Timeline._window) {
      try {
        Timeline._window.removeEventListener("unload", Timeline.destroy, false);
      } catch(ex) {}
    }
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
      Cu.unload("chrome://graphical-timeline/content/frontend/timeline-canvas.jsm");
      CanvasManager = null;
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
   * Gets the number of times the UI has been opened.
   * @return number
   */
  get timesUIOpened() {
    if (this._timesUIOpened === undefined) {
      this._timesUIOpened = Services.prefs.getIntPref("devtools.timeline.timesUIOpened");
    }
    return this._timesUIOpened;
  },

  /**
   * Sets the number of times the UI has been opened.
   * @param number value
   */
  set timesUIOpened(value) {
    Services.prefs.setIntPref("devtools.timeline.timesUIOpened", value);
    this._timesUIOpened = value;
  },

  /**
   * Gets the various stats of the user interaction with the UI.
   * @return object
   */
  get userStats() {
    if (this._userStats === undefined) {
      this._userStats = JSON.parse(Services.prefs.getCharPref("devtools.timeline.userStats"));
    }
    return this._userStats;
  },

  /**
   * Sets the various stats of the user interaction with the UI.
   * @param object value
   */
  set userStats(value) {
    Services.prefs.setCharPref("devtools.timeline.userStats", JSON.stringify(value));
    this._userStats = value;
  },

  /**
   * Gets the preferred compact mode status of the timeline UI.
   * @return boolean
   */
  get compactMode() {
    if (this._compactMode === undefined) {
      this._compactMode = Services.prefs.getBoolPref("devtools.timeline.compactMode");
    }
    return this._compactMode;
  },

  /**
   * Sets the preferred compact mode status of the timeline UI.
   * @param boolean value
   */
  set compactMode(value) {
    Services.prefs.setBoolPref("devtools.timeline.compactMode", value);
    this._compactMode = value;
  },

  /**
   * Gets the preference for restating the Timeline on page reload.
   */
  get doRestartOnReload() {
    if (this._doRestartOnReload === undefined) {
      this._doRestartOnReload =
        Services.prefs.getBoolPref("devtools.timeline.restartOnReload");
    }
    return this._doRestartOnReload;
  },

  /**
   * Sets the preference for restating the Timeline on page reload.
   * @param boolean aRestartOnReload
   */
  set doRestartOnReload(aRestartOnReload) {
    Services.prefs.setBoolPref("devtools.timeline.restartOnReload",
                               aRestartOnReload);
    this._doRestartOnReload = aRestartOnReload;
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
