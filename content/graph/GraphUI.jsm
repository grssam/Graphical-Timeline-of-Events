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

const NORMALIZED_EVENT_TYPE = {
  POINT_EVENT: 0, // An instantaneous event like a mouse click.
  CONTINUOUS_EVENT_START: 1, // Start of a process like reloading of a page.
  CONTINUOUS_EVENT_MID: 2, // End of a earlier started process.
  CONTINUOUS_EVENT_END: 3, // End of a earlier started process.
  REPEATING_EVENT_START: 4, // Start of a repeating event like a timer.
  REPEATING_EVENT_MID: 5, // An entity of a repeating event which is neither
                          // start nor end.
  REPEATING_EVENT_STOP: 6, // End of a repeating event.
};

const ERRORS = {
  ID_TAKEN: 0, // Id is already used by another timeline UI.
};

const COLOR_LIST = ["#1eff07", "#0012ff", "#20dbec", "#33b5ff", "#a8ff9c", "#b3f7ff",
                    "#f9b4ff", "#f770ff", "#ff0000", "#ff61fd", "#ffaf60", "#fffc04"];

/**
 * Canvas Content Handler.
 * Manages the canvas and draws anything on it when required.
 *
 * @param object aDoc
 *        reference to the document in which the canvas resides.
 */
function CanvasManager(aDoc) {
  this.doc = aDoc
  this.currentTime = this.startTime = (new Date()).getTime();
  this.lastVisibleTime = null;
  this.offsetTop = 0;
  this.scrolling = false;
  this.scrollStartTime = null;
  this.scrollOffset = 0;
  this.acceleration = 0;
  this.nonScrollingTimeGap = 0;
  this.lastWidth = 0;
  this.lastScrollStopTime = null;
  this.dirtyDots = [];
  // this.imageList = [];
  // this.patternList = [];

  // for (let i = 0; i < COLOR_LIST.length; i++) {
    // this.imageList[i] = new aDoc.defaultView.Image();
    // this.imageList[i].src = "chrome://graphical-timeline/content/graph/images/dots/" +
                            // COLOR_LIST[i].replace("#", "") + ".png";
  // }

  /**
   *  This will be the storage for the timestamp of events occuring ina group.
   * {
   *  "group1":
   *    {
   *      id: 1,
   *      y: 45, // Vertical location of the group.
   *      type: NORMALIZED_EVENT_TYPE.POINT_EVENT, // one of NORMALIZED_EVENT_TYPE
   *      producerId: "PageEventsProducer", // Id of the producer related to the data.
   *      active: true, // If it is a continuous event and is still not finished.
   *    },
   *  "another_group_and_so_on" : {...},
   * }
   */
  this.groupedData = {};

  this.globalTiming = [];
  this.globalGroup = [];

  // How many milli seconds per pixel.
  this.scale = 5;

  this.id = 0;
  this.waitForLineData = false;
  this.waitForDotData = false;

  this.canvasLines = aDoc.getElementById("timeline-canvas-lines");
  this.ctxL = this.canvasLines.getContext('2d');
  this.canvasDots = aDoc.getElementById("timeline-canvas-dots");
  this.ctxD = this.canvasDots.getContext('2d');
  this.canvasRuler = aDoc.getElementById("ruler-canvas");
  this.ctxR = this.canvasRuler.getContext('2d');

  //Building the line patterns
  // let imagePattern = [];
  // for (let i = 0; i < COLOR_LIST.length; i++) {
    // imagePattern[i] = new aDoc.defaultView.Image();
    // imagePattern[i].onload = function() {
      // this.patternList[i] = this.ctx.createPattern(imagePattern[i],'repeat');
    // }.bind(this);
    // imagePattern[i].src = "chrome://graphical-timeline/content/graph/images/lines/" +
                          // COLOR_LIST[i].replace("#", "") + ".png";
  // }

  // Bind
  this.renderDots = this.renderDots.bind(this);
  this.renderLines = this.renderLines.bind(this);
  this.renderRuler = this.renderRuler.bind(this);
  this.pushData = this.pushData.bind(this);
  this.drawDot = this.drawDot.bind(this);
  this.drawLine = this.drawLine.bind(this);
  this.hasGroup = this.hasGroup.bind(this);
  this.getOffsetForGroup = this.getOffsetForGroup.bind(this);
  this.updateGroupOffset = this.updateGroupOffset.bind(this);
  this.stopRendering = this.stopRendering.bind(this);
  this.startRendering = this.startRendering.bind(this);
  this.searchIndexForTime = this.searchIndexForTime.bind(this);
  this.stopScrolling = this.stopScrolling.bind(this);

  this.isRendering = true;
  this.renderDots();
  this.renderLines();
  this.renderRuler();
}

CanvasManager.prototype = {
  get width()
  {
    if (this._width === undefined) {
      this._width = this.canvasLines.width;
    }
    return this._width;
  },

  set width(val)
  {
    this._width = val;
    this.canvasRuler.width = this.canvasLines.width = this.canvasDots.width = val;
  },

  get height()
  {
    if (this._height === undefined) {
      this._height = this.canvasLines.height;
    }
    return this._height;
  },

  set height(val)
  {
    this._height = val;
    this.canvasLines.height = this.canvasDots.height = val;
  },

  hasGroup: function CM_hasGroup(aGroupId, producerId)
  {
    let temp = false;
    if (this.doc.getElementById("producers-pane").collapsed == true) {
      this.doc.getElementById("producers-pane").collapsed = false;
      temp = true;
    }
    let producerBox = this.doc.getElementById(producerId + "-box");

    if (!producerBox) {
      return false;
    }

    let feature = producerBox.firstChild.nextSibling.firstChild;
    while (feature) {
      if (feature.getAttribute("groupId") == aGroupId) {
        if (temp) {
          this.doc.getElementById("producers-pane").collapsed = true;
        }
        return true;
      }
      feature = feature.nextSibling;
    }
    if (temp) {
      this.doc.getElementById("producers-pane").collapsed = true;
    }
    return false;
  },

  /**
   * Gets the Y offset of the group residing in the Producers Pane.
   *
   * @param string aGroupId
   *        Id of the group to obtain the Y offset.
   *
   * @param string producerId
   *        Id of the producer, the group belongs to.
   *
   * @return number The offset of the groupId provided, or null.
   */
  getOffsetForGroup: function CM_getOffsetForGroup(aGroupId, producerId)
  {
    let temp = false;
    if (this.doc.getElementById("producers-pane").collapsed == true) {
      this.doc.getElementById("producers-pane").collapsed = false;
      temp = true;
    }
    let producerBoxes = this.doc.getElementsByClassName("producer-box");
    for (let i = 0; i < producerBoxes.length; i++) {
      let producerBox = producerBoxes[i];
      let id = producerBox.getAttribute("producerId");
      if (id != producerId) {
        continue;
      }

      if (producerBox.getAttribute("visible") == "false") {
        return (producerBox.firstChild.boxObject.y +
                producerBox.firstChild.boxObject.height/2 - 32);
      }

      let feature = producerBox.firstChild.nextSibling.firstChild;
      while (feature) {
        if (feature.getAttribute("groupId") == aGroupId) {
          if (temp) {
            this.doc.getElementById("producers-pane").collapsed = true;
          }
          return (feature.boxObject.y + feature.boxObject.height/2 - 32);
        }
        feature = feature.nextSibling;
      }
    }
    if (temp) {
      this.doc.getElementById("producers-pane").collapsed = true;
    }
    return null;
  },

  /**
   * Updates the Y offset related to each groupId.
   */
  updateGroupOffset: function CM_updateGroupOffset()
  {
    for (groupId in this.groupedData) {
      this.groupedData[groupId].y =
        this.getOffsetForGroup(groupId, this.groupedData[groupId].producerId);
    }
  },

  /**
   * Binary search to match for the index having time just less than the provided.
   *
   * @param number aTime
   *        The time to searach.
   */
  searchIndexForTime: function CM_searchIndexForTime(aTime)
  {
    let {length} = this.globalTiming;
    if (this.globalTiming[length - 1] < aTime) {
      return length - 1;
    }
    let left = 0, right = length - 1,mid;
    while (right - left > 1) {
      mid = Math.floor((left + right)/2);
      if (this.globalTiming[mid] > aTime) {
        right = mid;
      }
      else if (this.globalTiming[mid] < aTime) {
        left = mid;
      }
      else
        return mid;
    }
    return left;
  },

  /**
   * Gets the message and puts it into the groupedData.
   *
   * @param object aData
   *        The normalized event data read by the GraphUI from DataStore.
   */
  pushData: function CM_pushData(aData)
  {
    let groupId = aData.groupID;

    this.globalGroup.push(groupId);
    this.globalTiming.push(aData.time);
    switch (aData.type) {
      case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START:
        this.groupedData[groupId] = {
          id: this.id,
          y: this.getOffsetForGroup(groupId, aData.producer),
          type: NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START,
          producerId: aData.producer,
          active: true,
          timestamps: [aData.time],
        };
        this.id++;
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        if (this.waitForLineData) {
          this.waitForLineData = false;
          this.renderLines();
        }
        break;

      case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID:
        this.groupedData[groupId].timestamps.push(aData.time);
        this.id++;
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        break;

      case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END:
        this.groupedData[groupId].timestamps.push(aData.time);
        this.groupedData[groupId].active = false;
        this.id++;
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        if (this.waitForLineData) {
          this.waitForLineData = false;
          this.renderLines();
        }
        break;

      case NORMALIZED_EVENT_TYPE.POINT_EVENT:
        if (!this.groupedData[groupId]) {
          this.groupedData[groupId] = {
            id: this.id,
            y: this.getOffsetForGroup(groupId, aData.producer),
            type: NORMALIZED_EVENT_TYPE.POINT_EVENT,
            producerId: aData.producer,
            active: false,
            timestamps: [aData.time],
          };
        }
        else {
          this.groupedData[groupId].timestamps.push(aData.time);
        }
        this.id++;
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        break;
    }
  },

  /**
   * Draws a dot to represnt an event at the x,y.
   */
  drawDot: function CM_drawDot(x, y, id)
  {
    if (this.offsetTop > y) {
      return;
    }
    //this.ctx.drawImage(this.imageList[id%12],x - 5,y - 6 - this.offsetTop,10,12);
    this.ctxD.beginPath();
    this.ctxD.fillStyle = COLOR_LIST[id%12];
    this.dirtyDots.push({x:x,y:y-this.offsetTop});
    this.ctxD.arc(x,y - this.offsetTop, 5, 0, 6.2842,true);
    this.ctxD.fill();
  },

  /**
   * Draws a horizontal line from x,y to endx,y.
   */
  drawLine: function CM_drawLine(x, y, id, endx)
  {
    if (this.offsetTop > y) {
      return;
    }
    this.ctxL.fillStyle = COLOR_LIST[id%12];
    this.ctxL.fillRect(x, y - 2 - this.offsetTop, endx-x, 4);
  },

  startRendering: function CM_startRendering()
  {
    if (!this.isRendering) {
      this.isRendering = true;
      this.renderDots();
      this.renderLines();
      this.renderRuler();
    }
  },

  stopRendering: function CM_stopRendering()
  {
    this.isRendering = false;
  },

  startScrolling: function CM_startScrolling()
  {
    if (!this.scrollStartTime) {
      this.scrollStartTime = (new Date()).getTime();
      this.scrollOffset = 0;
    }
    if (!this.scrolling && this.lastScrollStopTime != null) {
      this.nonScrollingTimeGap += ((new Date()).getTime() - this.lastScrollStopTime);
    }
    this.scrolling = true;
    if (this.waitForDotData) {
      this.waitForDotData = false;
      this.renderDots();
    }
    if (this.waitForLineData) {
      this.waitForLineData = false;
      this.renderLines();
    }
  },

  stopScrolling: function CM_stopScrolling()
  {
    this.acceleration = 0;
    this.lastScrollStopTime = (new Date()).getTime();
    this.scrollOffset = this.lastScrollStopTime - this.currentTime;
    this.scrolling = false;
  },

  /**
   * Renders the canvas ruler.
   */
  renderRuler: function CM_renderRuler()
  {
    if (!this.isRendering) {
      return;
    }
    this.ctxR.clearRect(0,0,this.width,25);
    // getting the current time, which will be at the center of the canvas.
    if (!this.scrolling) {
      this.currentTime = (new Date()).getTime() - this.scrollOffset;
    }
    else if (this.acceleration != 0) {
      this.currentTime = this.nonScrollingTimeGap +
        this.scrollStartTime - this.acceleration * ((new Date()).getTime() - this.scrollStartTime -
                                                    this.nonScrollingTimeGap) / 100;
    }
    this.firstVisibleTime = this.currentTime - 0.5*this.width*this.scale;
    this.ctxR.beginPath();
    this.ctxR.strokeStyle = "rgb(3,101,151)";
    this.ctxR.lineWidth = 2;
    this.ctxR.font = "16px sans-serif";
    for (let i = -1*((this.firstVisibleTime/this.scale)%1000), j = 0;
         i < this.width;
         i += 100/this.scale, j++) {
      if (i < 0) {
        continue;
      }
      this.ctxR.moveTo(i,25);
      if (j%10 == 0) {
        this.ctxR.lineWidth = 1;
        this.ctxR.strokeText((new Date(this.firstVisibleTime + i*this.scale)).getMinutes() + "  " +
                             (new Date(this.firstVisibleTime + i*this.scale)).getSeconds(), i - 22, 12);
        this.ctxR.lineWidth = 2;
        this.ctxR.lineTo(i,5);
      }
      else if (j%5 == 0) {
        this.ctxR.lineTo(i,10);
      }
      else {
        this.ctxR.lineTo(i,15);
      }
    }
    this.ctxR.stroke();
    this.doc.defaultView.mozRequestAnimationFrame(this.renderRuler);
  },

  /**
   * Renders the canvas dots.
   */
  renderDots: function CM_renderDots()
  {
    if (!this.isRendering || this.waitForDotData) {
      return;
    }
    let objectsDrawn = 0;

    this.ctxD.shadowOffsetY = 2;
    this.ctxD.shadowColor = "rgba(10,10,10,0.5)";
    this.ctxD.shadowBlur = 2;

    for each (let {x,y} in this.dirtyDots) {
      this.ctxD.clearRect(x-7,y-7,14,20);
    }
    this.dirtyDots = [];
    // if (this.scrollOffset > 0 || this.scrollStartTime != null) {
      // this.ctxD.clearRect(0,0,this.width,this.height);
    // }
    // else {
      // this.ctxD.clearRect(0,0,0.5*this.width + (this.scrolling?
                          // ((new Date()).getTime() - this.currentTime)/this.scale
                          // :this.scrollOffset/this.scale) + 10,this.height);
    // }
    // getting the current time, which will be at the center of the canvas.
    let i;
    if (!this.scrolling) {
      this.currentTime = (new Date()).getTime() - this.scrollOffset;
      i = this.globalTiming.length - 1;
      this.lastVisibleTime = this.currentTime + 0.5*this.width*this.scale;
    }
    else if (this.acceleration != 0) {
      this.currentTime = this.nonScrollingTimeGap +
        this.scrollStartTime - this.acceleration * ((new Date()).getTime() - this.scrollStartTime -
                                                    this.nonScrollingTimeGap) / 100;
      this.lastVisibleTime = this.currentTime + 0.5*this.width*this.scale;
      i = this.searchIndexForTime(this.lastVisibleTime);
    }
    this.firstVisibleTime = this.lastVisibleTime - this.width*this.scale;

    for (; i >= 0; i--) {
      if (this.globalTiming[i] >= this.firstVisibleTime) {
        this.drawDot((this.globalTiming[i] - this.firstVisibleTime)/this.scale,
                     this.groupedData[this.globalGroup[i]].y,
                     this.groupedData[this.globalGroup[i]].id);
        objectsDrawn++;
      }
      // No need of going down further as time is already below visible state.
      else {
        break;
      }
    }

    if (objectsDrawn == 0 && !this.scrolling) {
      this.waitForDotData = true;
    }
    else {
      this.doc.defaultView.mozRequestAnimationFrame(this.renderDots);
    }
  },

  /**
   * Renders the canvas lines.
   */
  renderLines: function CM_renderLines()
  {
    if (!this.isRendering || this.waitForLineData) {
      return;
    }
    let objectsDrawn = 0;
    this.currentWidth = 0.5*this.width +
      (this.scrolling? ((new Date()).getTime() - this.currentTime)/this.scale:
                       this.scrollOffset/this.scale);

    if (this.scrollOffset > 0 || this.scrollStartTime != null) {
      this.ctxL.clearRect(0,0,this.width,this.height);
    }
    else {
      this.ctxL.clearRect(0,0,this.currentWidth + 10,this.height);
    }
    // getting the current time, which will be at the center of the canvas.
    if (!this.scrolling) {
      this.currentTime = (new Date()).getTime() - this.scrollOffset;
    }
    else if (this.acceleration != 0) {
      this.currentTime = this.nonScrollingTimeGap +
        this.scrollStartTime - this.acceleration * ((new Date()).getTime() - this.scrollStartTime -
                                                    this.nonScrollingTimeGap) / 100;
    }
    this.firstVisibleTime = this.currentTime - 0.5*this.width*this.scale;

    let endx,x;
    for each (group in this.groupedData) {
      if (group.active && group.timestamps[group.timestamps.length - 1] < this.firstVisibleTime) {
        this.drawLine(0, group.y, group.id, this.currentWidth);
        objectsDrawn++;
      }
      else if (group.timestamps[group.timestamps.length - 1] > this.firstVisibleTime &&
               (group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END ||
                group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START ||
                group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID)) {
        x = (Math.max(group.timestamps[0], this.firstVisibleTime) - this.firstVisibleTime)/this.scale;
        if (!group.active) {
          endx = (group.timestamps[group.timestamps.length - 1] - this.firstVisibleTime)/this.scale;
        }
        else {
         endx = this.scrolling? 0.5*this.width + ((new Date()).getTime() -
                                this.currentTime)/this.scale
                              :(this.currentTime - this.firstVisibleTime +
                                this.scrollOffset)/this.scale;
        }
        this.drawLine(x,group.y,group.id,endx);
        objectsDrawn++;
      }
    }

    // Drawing one vertical line at end to represent current time.
    if (this.scrollOffset != 0 || this.scrolling) {
      this.ctxL.fillStyle = "rgba(3,101,151,0.75)";
      this.ctxL.fillRect(this.currentWidth, 0, 2, this.height);
    }

    if (objectsDrawn == 0 && !this.scrolling) {
      this.waitForLineData = true;
    }
    else {
      this.doc.defaultView.mozRequestAnimationFrame(this.renderLines);
    }
  }
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
  this.canvasStarted = false;
  this.recording = false;
  this.producersPaneOpened = false;
  this.startingScrollOffset = null;

  this._frame = ownerDocument.createElement("iframe");
  this._frame.height = TimelinePreferences.height;
  this._nbox = gBrowser.getNotificationBox(gBrowser.selectedTab.linkedBrowser);
  this._nbox.appendChild(this._splitter);
  this._nbox.appendChild(this._frame);
  this._canvas = null;

  this.createProducersPane = this.createProducersPane.bind(this);
  this.toggleProducersPane = this.toggleProducersPane.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.toggleFeature = this.toggleFeature.bind(this);
  this.moveToCurrentTime = this.moveToCurrentTime.bind(this);
  this.toggleProducer = this.toggleProducer.bind(this);
  this.toggleProducerBox = this.toggleProducerBox.bind(this);
  this.addGroupBox = this.addGroupBox.bind(this);
  this.handleScroll = this.handleScroll.bind(this);
  this.closeUI = this.closeUI.bind(this);
  this.$ = this.$.bind(this);
  this._showProducersPane = this._showProducersPane.bind(this);
  this._hideProducersPane = this._hideProducersPane.bind(this);
  this._onLoad = this._onLoad.bind(this);
  this._onDragStart = this._onDragStart.bind(this);
  this._onDrag = this._onDrag.bind(this);
  this._onDragEnd = this._onDragEnd.bind(this);
  this._onUnload = this._onUnload.bind(this);

  this._frame.addEventListener("load", this._onLoad, true);
  this._frame.setAttribute("src", "chrome://graphical-timeline/content/graph/timeline.xul");
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
    this.producersButton = this.$("producers");
    this.currentTimeButton = this.$("current");
    this.producersPane = this.$("producers-pane");
    // Attaching events.
    this._frameDoc.defaultView.onresize = this.onFrameResize.bind(this);
    this.producersPane.onscroll = this.onProducersScroll.bind(this);
    this.closeButton.addEventListener("command", GraphUI.destroy, true);
    this.recordButton.addEventListener("command", this.toggleRecording, true);
    this.producersButton.addEventListener("command", this.toggleProducersPane, true);
    this.currentTimeButton.addEventListener("command", this.moveToCurrentTime, true);
    this._frame.addEventListener("unload", this._onUnload, true);
    // Building the UI according to the preferences.
    if (TimelinePreferences.visiblePanes.indexOf("producers") == -1) {
      this.producersPane.setAttribute("visible", false);
      this.producersPane.collapsed = true;
      this.producersPaneOpened = false;
      this.producersButton.checked = false;
    }
    else {
      this.producersPane.setAttribute("visible", true);
      this.producersPaneOpened = true;
      this.producersButton.checked = true;
      this.producersPane.collapsed = false;
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
    let request = aData.details.log.entries[0].request;
    let featureBox = producerBox.firstChild.nextSibling;
    let urlLabel = this._frameDoc.createElement("label");
    urlLabel.setAttribute("groupId", aData.groupID);
    urlLabel.setAttribute("value", request.method.toUpperCase() + " " + request.url);
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
      for each (let feature in producer.features) {
        let featureCheckbox = this._frameDoc.createElement("checkbox");
        featureCheckbox.setAttribute("class", "devtools-checkbox");
        featureCheckbox.setAttribute("flex", "1");
        featureCheckbox.setAttribute("label", feature);
        featureCheckbox.setAttribute("groupId", feature);
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
   * Moves the view to current time.
   */
  moveToCurrentTime: function TV_moveToCurrentTime()
  {
    if (this._canvas.scrollOffset == 0) {
      this.startingScrollOffset = null;
      this.$("timeline-current-time").style.left = this._canvas.width*0.5 + "px"
      this.currentTimeButton.setAttribute("checked", true);
      this._canvas.scrollStartTime = this._canvas.lastScrollStopTime = null;
      this._canvas.nonScrollingTimeGap = 0;
    }
    else if ((this._canvas.scrollOffset >= 0 &&
             this._canvas.scrollOffset < this.startingScrollOffset/30) ||
            (this._canvas.scrollOffset < 0 &&
             this._canvas.scrollOffset > this.startingScrollOffset/30)) {
      this._canvas.nonScrollingTimeGap = this._canvas.scrollOffset = 0;
      this._frameDoc.defaultView.setTimeout(this.moveToCurrentTime, 1000/60);
      if (this._canvas.waitForLineData) {
        this._canvas.waitForLineData = false;
        this._canvas.renderLines();
      }
      if (this._canvas.waitForDotData) {
        this._canvas.waitForDotData = false;
        this._canvas.renderDots();
      }
    }
    else {
      if (this.startingScrollOffset == null) {
        this.startingScrollOffset = this._canvas.scrollOffset;
      }
      this._canvas.scrollOffset -= this.startingScrollOffset/30;
      this._frameDoc.defaultView.setTimeout(this.moveToCurrentTime, 1000/60);
      if (this._canvas.waitForLineData) {
        this._canvas.waitForLineData = false;
        this._canvas.renderLines();
      }
      if (this._canvas.waitForDotData) {
        this._canvas.waitForDotData = false;
        this._canvas.renderDots();
      }
    }
  },

  onFrameResize: function TV_onFrameResize()
  {
    if (this.canvasStarted) {
      if (Math.abs(this.producersPane.scrollHeight - this._canvas.height) > 50) {
        this._canvas.height = this.producersPane.scrollHeight;
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
    this.producersPane.setAttribute("visible", true);
    this.producersPane.collapsed = false;
  },

  _hideProducersPane: function TV__hideProducersPane()
  {
    this.producersPaneOpened = false;
    this.producersPane.setAttribute("visible", false);
    this.producersPane.collapsed = true;
  },

  /**
   * Starts and stops the listening of Data.
   */
  toggleRecording: function TV_toggleRecording()
  {
    if (!this.recording) {
      let message = {
        enabledProducers: {},
        timelineUIId: GraphUI.id,
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
      GraphUI.startListening(message);
      // Starting the canvas.
      if (!this.canvasStarted) {
        this._canvas = new CanvasManager(this._frameDoc);
        this._canvas.width = this.$("timeline-content").boxObject.width;
        this.currentTimeButton.setAttribute("checked", true);
        this.$("timeline-current-time").style.left = this._canvas.width*0.5 + "px"
        this._canvas.height = this.$("canvas-container").boxObject.height;
        this.canvasStarted = true;
        this.handleScroll();
      }
      else {
        this._canvas.startRendering();
      }
    }
    else {
      GraphUI.stopListening({timelineUIId: GraphUI.id});
      this._canvas.stopRendering();
    }
    this.recording = !this.recording;
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
      GraphUI.enableFeatures(linkedProducerId, [feature]);
    }
    else {
      GraphUI.disableFeatures(linkedProducerId, [feature]);
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
      GraphUI.startProducer(producerId, features);
    }
    else {
      GraphUI.stopProducer(producerId);
    }
  },

  onProducersScroll: function TV_onProducersScroll(aEvent)
  {
    if (aEvent.target.scrollTop) {
      this._canvas.offsetTop = aEvent.target.scrollTop;
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
    }
    else {
      producerBox.setAttribute("visible", true);
    }
    if (this.canvasStarted) {
      this._frameDoc.defaultView.setTimeout(this._canvas.updateGroupOffset, 300);
    }
  },

  /**
   * Gets the data and sends it to the canvas to display
   *
   * @param object aData
   *        Normalized event data.
   */
  displayData: function NV_displayData(aData)
  {
    if (!this._canvas.hasGroup(aData.groupID, aData.producer)) {
      this.addGroupBox(aData);
      this._canvas.updateGroupOffset();
    }
    this._canvas.pushData(aData);
  },

  _onDragStart: function TV__onDragStart(aEvent)
  {
    this.$("timeline-current-time").removeEventListener("mousedown",
                                                        this._onDragStart, true);
    this.$("canvas-container").addEventListener("mousemove",
                                                this._onDrag, true);
    this._frameDoc.addEventListener("mouseup",
                                    this._onDragEnd, true);
    this._frameDoc.addEventListener("click",
                                    this._onDragEnd, true);
  },

  _onDrag: function TV__onDrag(aEvent)
  {
    this._canvas.startScrolling();
    try {
      this.currentTimeButton.removeAttribute("checked");
    } catch (ex) {}

    this.$("timeline-current-time").style.left =
      (aEvent.clientX - this.$("canvas-container").boxObject.x) + "px";
    this._canvas.acceleration = this._canvas.width/2 - aEvent.clientX +
                                this.$("canvas-container").boxObject.x;
  },

  _onDragEnd: function TV__onDragEnd(aEvent)
  {
    this._canvas.stopScrolling();
    this.$("canvas-container").removeEventListener("mousemove",
                                                   this._onDrag, true);
    this._frameDoc.removeEventListener("mouseup",
                                       this._onDragEnd, true);
    this._frameDoc.removeEventListener("click",
                                       this._onDragEnd, true);
    this.handleScroll();
  },

  /**
   * Handles dragging of the current time vertical line to scroll to previous time.
   */
  handleScroll: function TV_handleScroll()
  {
    this.$("timeline-current-time").addEventListener("mousedown",
                                                     this._onDragStart, true);
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
    if (this.producersPane.getAttribute("visible") == "true") {
      TimelinePreferences.visiblePanes = ["producers"];
    }
    else {
      TimelinePreferences.visiblePanes = [];
    }
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
let GraphUI = {

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

  /**
   * Prepares the UI and sends ping to the Data Sink.
   */
  init: function GUI_init(aCallback) {
    GraphUI.callback = aCallback;
    GraphUI._window = Cc["@mozilla.org/appshell/window-mediator;1"]
                        .getService(Ci.nsIWindowMediator)
                        .getMostRecentWindow("navigator:browser");
    //GraphUI._console = Cc["@mozilla.org/consoleservice;1"]
    //                     .getService(Ci.nsIConsoleService);
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
    if (!GraphUI._view) {
      GraphUI._view = new TimelineView(GraphUI._window);
    }
    GraphUI._view.createProducersPane(GraphUI.producerInfoList);
    GraphUI.UIOpened = true;
  },

  /**
   * Starts the Data Sink and all the producers.
   */
  startListening: function GUI_startListening(aMessage) {
    //GraphUI.timer = GraphUI._window.setInterval(GraphUI.readData, 25);
    GraphUI.sendMessage(UIEventMessageType.START_RECORDING, aMessage);
    GraphUI.listening = true;
    GraphUI.shouldDeleteDatabaseItself = false;
  },

  /**
   * Stops the Data Sink and all the producers.
   */
  stopListening: function GUI_stopListening(aMessage) {
    if (!GraphUI.listening) {
      return;
    }
    //GraphUI._window.clearInterval(GraphUI.timer);
    //GraphUI.timer = null;
    GraphUI.sendMessage(UIEventMessageType.STOP_RECORDING, aMessage);
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
      // Importing the Data Store and making a database
      //Cu.import("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
      //GraphUI.dataStore = new DataStore(GraphUI.databaseName);
      GraphUI.buildUI();
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
      timelineUIId: GraphUI.id,
      producerId: aProducerId,
      features: aFeatures,
    };
    GraphUI.sendMessage(UIEventMessageType.ENABLE_FEATURES, message);
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
      timelineUIId: GraphUI.id,
      producerId: aProducerId,
      features: aFeatures,
    };
    GraphUI.sendMessage(UIEventMessageType.DISABLE_FEATURES, message);
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
      timelineUIId: GraphUI.id,
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
  stopProducer: function GUI_stopProducer(aProducerId)
  {
    let message = {
      timelineUIId: GraphUI.id,
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
      //GraphUI.dataStore.getRangeById(GraphUI.processData, GraphUI._currentId);
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
    for (let i = 0; i < aData.length; i++) {
      GraphUI._view.displayData(aData[i]);
      // GraphUI._console
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
        GraphUI.handlePingReply(message);
        break;

      case DataSinkEventMessageType.NEW_DATA:
        GraphUI.newDataAvailable = true;
        GraphUI.processData([message]);
        break;

      case DataSinkEventMessageType.UPDATE_UI:
        if (message.timelineUIId != GraphUI.id) {
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
      if (GraphUI.listening) {
        //GraphUI._window.clearInterval(GraphUI.timer);
        //GraphUI.timer = null;
      }
      //GraphUI.dataStore.destroy(GraphUI.shouldDeleteDatabaseItself);
      try {
        Cu.unload("chrome://graphical-timeline/content/data-sink/DataStore.jsm");
      } catch (ex) {}
      //DataStore = GraphUI.dataStore = null;
      GraphUI.sendMessage(UIEventMessageType.DESTROY_DATA_SINK,
                          {deleteDatabase: true, // true to delete the database
                           timelineUIId: GraphUI.id, // to tell which UI is closing.
                          });
      GraphUI.shouldDeleteDatabaseItself = true;
      GraphUI.pingSent = GraphUI.listening = false;
      GraphUI.removeRemoteListener(GraphUI._window);
      GraphUI._view.closeUI();
      GraphUI._view = GraphUI.newDataAvailable = GraphUI.UIOpened =
        GraphUI._currentId = GraphUI._window = null;
      GraphUI.producerInfoList = null;
      if (GraphUI.callback)
        GraphUI.callback();
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
