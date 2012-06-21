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

const CANVAS_POSITION = {
  START: 0, // Represents the starting of the view
  CENTER: 1, // Represents center of view.
  END: 2, // Represents end of view.
};

const COLOR_LIST = ["#1eff07", "#0012ff", "#20dbec", "#33b5ff", "#a8ff9c", "#b3f7ff",
                    "#f9b4ff", "#f770ff", "#ff0000", "#ff61fd", "#ffaf60", "#fffc04"];

const HTML = "http://www.w3.org/1999/xhtml";

/**
 * Canvas Content Handler.
 * Manages the canvas and draws anything on it when required.
 *
 * @param object aDoc
 *        reference to the document in which the canvas resides.
 */
function CanvasManager(aDoc) {
  this.doc = aDoc
  this.currentTime = this.startTime = Date.now();
  this.lastVisibleTime = null;
  this.offsetTop = 0;
  this.scrolling = false;
  this.offsetTime = 0;
  this.acceleration = 0;
  this.dirtyDots = [];
  this.dirtyZone = [];

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
  this.freezeCanvas = this.freezeCanvas.bind(this);
  this.unfreezeCanvas = this.unfreezeCanvas.bind(this);
  this.moveToCurrentTime = this.moveToCurrentTime.bind(this);
  this.moveToTime = this.moveToTime.bind(this);
  this.moveGroupInView = this.moveGroupInView.bind(this);
  this.searchIndexForTime = this.searchIndexForTime.bind(this);
  this.stopScrolling = this.stopScrolling.bind(this);

  this.isRendering = true;
  this.timeFrozen = false;
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

  hasGroup: function CM_hasGroup(aData)
  {
    let temp = false;
    if (this.doc.getElementById("producers-pane").collapsed == true) {
      this.doc.getElementById("producers-pane").collapsed = false;
      temp = true;
    }
    let groupBox = null;
    switch (aData.type) {
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_MID:
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START:
      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_STOP:
        groupBox = this.doc.getElementById(aData.name.replace(" ", "_") + "-groupbox");
        break;

      default:
        groupBox = this.doc.getElementById(aData.groupID + "-groupbox");
    }

    if (temp) {
      this.doc.getElementById("producers-pane").collapsed = true;
    }

    if (groupBox && groupBox.parentNode.getAttribute("producerId") == aData.producer) {
      return true;
    }
    else {
      return false;
    }
  },

  /**
   * Gets the Y offset of the group residing in the Producers Pane.
   *
   * @param string aGroupId
   *        Id of the group to obtain the Y offset.
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
      if (this.groupedData[groupId].type == NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START) {
        this.groupedData[groupId].y =
          this.getOffsetForGroup(this.groupedData[groupId].name.replace(" ", "_"),
                                 this.groupedData[groupId].producerId);
      }
      else {
        this.groupedData[groupId].y =
          this.getOffsetForGroup(groupId, this.groupedData[groupId].producerId);
      }
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

  insertAtCorrectPosition: function CM_insertAtCorrectPosition(aTime, aGroupId)
  {
    let {length} = this.globalTiming;
    if (this.globalTiming[length - 1] < aTime) {
      this.globalGroup.push(aGroupId);
      this.globalTiming.push(aTime);
      return;
    }
    let left = 0, right = length - 1,mid, i = null;
    while (right - left > 1) {
      mid = Math.floor((left + right)/2);
      if (this.globalTiming[mid] > aTime) {
        right = mid;
      }
      else if (this.globalTiming[mid] < aTime) {
        left = mid;
      }
      else {
        i = mid;
        break;
      }
    }
    if (i == null) {
      i = left;
    }
    this.globalGroup.splice(i,0,aGroupId);
    this.globalTiming.splice(i,0,aTime);
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

    this.insertAtCorrectPosition(aData.time, groupId);
    switch (aData.type) {
      case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START:
        this.groupedData[groupId] = {
          id: this.id,
          name: aData.name,
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

      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START:
        if (!this.groupedData[groupId]) {
          this.groupedData[groupId] = {
            id: this.id,
            name: aData.name,
            y: this.getOffsetForGroup(aData.name.replace(" ", "_"), aData.producer),
            type: NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START,
            producerId: aData.producer,
            active: true,
            timestamps: [[aData.time]],
          };
          this.id++;
        }
        else {
          this.groupedData[groupId].timestamps.push([aData.time]);
        }
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        if (this.waitForLineData) {
          this.waitForLineData = false;
          this.renderLines();
        }
        break;

      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_MID:
        this.groupedData[groupId].timestamps[
          this.groupedData[groupId].timestamps.length - 1
        ].push(aData.time);
        this.id++;
        if (this.waitForDotData) {
          this.waitForDotData = false;
          this.renderDots();
        }
        break;

      case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_STOP:
        this.groupedData[groupId].timestamps[
          this.groupedData[groupId].timestamps.length - 1
        ].push(aData.time);
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

  freezeCanvas: function CM_freezeCanvas()
  {
    this.frozenTime = this.currentTime;
    this.timeFrozen = true;
    try {
      this.doc.getElementById("play").removeAttribute("checked");
    } catch(e) {}
    if (this.waitForDotData) {
      this.waitForDotData = false;
      this.renderDots();
    }
    if (this.waitForLineData) {
      this.waitForLineData = false;
      this.renderLines();
    }
  },

  unfreezeCanvas: function CM_unfreezeCanvas()
  {
    this.timeFrozen = false;
  },

  /**
   * Moves the view to current time.
   *
   * @param boolean aAnimate
   *        If true, the view will rapidly scroll towards the current time.
   *        (true by default)
   */
  moveToCurrentTime: function TV_moveToCurrentTime(aAnimate)
  {
    if (aAnimate != null && aAnimate == false) {
      this.stopScrolling();
      this.unfreezeCanvas();
      this.offsetTime = 0;
      return;
    }
    if (this.offsetTime == 0 && !this.timeFrozen) {
      this.startingoffsetTime = null;
      this.movingView = false;
    }
    else if (!this.timeFrozen &&
             ((this.offsetTime >= 0 &&
               this.offsetTime < this.startingoffsetTime/30) ||
              (this.offsetTime < 0 &&
               this.offsetTime > this.startingoffsetTime/30))) {
      this.offsetTime = 0;
      this.startingoffsetTime = null;
      this.movingView = false;
      if (this.waitForLineData) {
        this.waitForLineData = false;
        this.renderLines();
      }
      if (this.waitForDotData) {
        this.waitForDotData = false;
        this.renderDots();
      }
    }
    else {
      if (this.startingoffsetTime == null) {
        if (this.movingView) {
          return;
        }
        this.movingView = true;
        this.offsetTime += Date.now() - this.frozenTime;
        this.frozenTime = Date.now();
        this.unfreezeCanvas();
        this.startingoffsetTime = this.offsetTime;
      }
      this.offsetTime -= this.startingoffsetTime/30;
      this.doc.defaultView.mozRequestAnimationFrame(this.moveToCurrentTime);
      if (this.waitForLineData) {
        this.waitForLineData = false;
        this.renderLines();
      }
      if (this.waitForDotData) {
        this.waitForDotData = false;
        this.renderDots();
      }
    }
  },

  /**
   * Moves the view to the provided time.
   *
   * @param nummber aTime
   *        The time to move to.
   * @param number aPosition
   *        One of CANVAS_POSITION. (default CANVAS_POSITION.CENTER)
   * @param boolean aAnimate
   *        If true, view will rapidly animate to the provided time.
   *        (true by default)
   */
  moveToTime: function CM_moveToTime(aTime, aPosition, aAnimate)
  {
    switch(aPosition) {
      case CANVAS_POSITION.START:
        this.finalFrozenTime = aTime + 0.8*this.width*this.scale;
        break;

      case CANVAS_POSITION.END:
        this.finalFrozenTime = aTime - 0.2*this.width*this.scale;
        break;

      default:
        aPosition = CANVAS_POSITION.CENTER;
        this.finalFrozenTime = aTime + 0.3*this.width*this.scale;
        break;
    }
    if (aAnimate != null && aAnimate == false) {
      this.freezeCanvas();
      this.frozenTime = this.finalFrozenTime;
      this.offsetTime = 0;
      return;
    }
    if (this.initialFrozenTime == null) {
      if (!this.timeFrozen) {
        this.freezeCanvas();
      }
      else {
        this.frozenTime -= this.offsetTime;
        this.offsetTime = 0;
      }
      this.initialFrozenTime = this.frozenTime;
    }
    if ((this.finalFrozenTime - this.frozenTime >= 0 &&
         this.finalFrozenTime - this.frozenTime <= 0.05*(this.initialFrozenTime - this.finalFrozenTime)) ||
        (this.finalFrozenTime - this.frozenTime < 0 &&
         this.finalFrozenTime - this.frozenTime >= 0.05*(this.initialFrozenTime - this.finalFrozenTime))) {
      this.freezeCanvas();
      this.frozenTime = this.finalFrozenTime;
      this.finalFrozenTime = this.initialFrozenTime = null;
      this.movingView = false;
      if (this.waitForLineData) {
        this.waitForLineData = false;
        this.renderLines();
      }
      if (this.waitForDotData) {
        this.waitForDotData = false;
        this.renderDots();
      }
    }
    else {
      this.movingView = true;
      this.frozenTime -= 0.05*(this.initialFrozenTime - this.finalFrozenTime);
      this.doc.defaultView
          .mozRequestAnimationFrame(function() {
        this.moveToTime(aTime, aPosition, true);
      }.bind(this));
      if (this.waitForLineData) {
        this.waitForLineData = false;
        this.renderLines();
      }
      if (this.waitForDotData) {
        this.waitForDotData = false;
        this.renderDots();
      }
    }
  },

  moveGroupInView: function moveGroupInView(aGroupId)
  {
    if (this.movingView) {
      return;
    }
    if (this.groupedData[aGroupId]) {
      let group = this.groupedData[aGroupId];
      let time = null;
      switch (group.type) {
        case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_STOP:
        case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START:
        case NORMALIZED_EVENT_TYPE.REPEATING_EVENT_MID:
          time = group.timestamps[group.timestamps.length - 1][0];
          break;

        case NORMALIZED_EVENT_TYPE.POINT_EVENT:
          time = group.timestamps[group.timestamps.length - 1];
          break;

        case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END:
        case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID:
        case NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START:
          time = group.timestamps[0];
          break;

        default:
          return;
      }
      this.moveToTime(time);
    }
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
    this.ctxL.clearRect(0,0,this.width,this.height);
    this.ctxD.clearRect(0,0,this.width,this.height);
    this.ctxR.clearRect(0,0,this.width,25);
    this.groupedData = {};
    this.globalTiming = [];
    this.globalGroup = [];
    this.dirtyDots = [];
    this.dirtyZone = [];
    this.waitForDotData = this.waitForLineData = false;
    this.id = 0;
  },

  startScrolling: function CM_startScrolling()
  {
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
    this.offsetTime = this.frozenTime - this.currentTime;
    this.scrolling = false;
  },

  /**
   * Draws a dot to represnt an event at the x,y.
   */
  drawDot: function CM_drawDot(x, y, id)
  {
    if (this.offsetTop > y || y - this.offsetTop > this.height ||
        x < 0 || x > this.width) {
      return;
    }
    //this.ctx.drawImage(this.imageList[id%12],x - 5,y - 6 - this.offsetTop,10,12);
    this.ctxD.beginPath();
    this.ctxD.fillStyle = COLOR_LIST[id%12];
    this.dirtyDots.push({x:x,y:y-this.offsetTop});
    this.ctxD.arc(x,y - this.offsetTop -0.5, 3, 0, 6.2842,true);
    this.ctxD.fill();
    this.dotsDrawn++;
  },

  /**
   * Draws a horizontal line from x,y to endx,y.
   */
  drawLine: function CM_drawLine(x, y, id, endx)
  {
    if (this.offsetTop > y || y - this.offsetTop > this.height) {
      return;
    }
    this.ctxL.fillStyle = COLOR_LIST[id%12];
    this.ctxL.fillRect(x, y - 1.5 - this.offsetTop, endx-x, 2);
    this.linesDrawn++;
    this.dirtyZone[0] = Math.min(this.dirtyZone[0],x);
    this.dirtyZone[1] = Math.max(this.dirtyZone[1],endx);
    this.dirtyZone[2] = Math.min(this.dirtyZone[2],y - 1 - this.offsetTop);
    this.dirtyZone[3] = Math.max(this.dirtyZone[3],y + 1 - this.offsetTop);
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
    if (this.timeFrozen) {
      if (!this.scrolling) {
        this.currentTime = this.frozenTime - this.offsetTime;
      }
      else if (this.acceleration != 0) {
        this.currentTime = this.frozenTime - this.offsetTime -
                           this.acceleration * (Date.now() - this.frozenTime) / 100;
      }
    }
    else {
      this.currentTime = Date.now() - this.offsetTime;
    }
    this.firstVisibleTime = this.currentTime - 0.8*this.width*this.scale;
    this.ctxR.strokeStyle = "rgb(3,101,151)";
    this.ctxR.fillStyle = "rgb(3,101,151)";
    this.ctxR.font = "16px sans-serif";
    this.ctxR.lineWidth = 1;
    for (let i = -1*((this.firstVisibleTime/this.scale)%1000), j = 0;
         i < this.width;
         i += 100/this.scale, j++) {
      if (i < 0) {
        continue;
      }
      if (j%10 == 0) {
        this.ctxR.strokeText((new Date(this.firstVisibleTime + i*this.scale)).getMinutes() + "  " +
                             (new Date(this.firstVisibleTime + i*this.scale)).getSeconds(), i - 22, 12);
        this.ctxR.fillRect(i+0.5,5,1,20);
      }
      else if (j%5 == 0) {
        this.ctxR.fillRect(i+0.5,10,1,15);
      }
      else {
        this.ctxR.fillRect(i+0.5,15,1,10);
      }
    }
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
    this.dotsDrawn = 0;

    this.ctxD.shadowOffsetY = 2;
    this.ctxD.shadowColor = "rgba(10,10,10,0.5)";
    this.ctxD.shadowBlur = 2;

    for each (let {x,y} in this.dirtyDots) {
      this.ctxD.clearRect(x-6,y-5,14,18);
    }
    this.dirtyDots = [];
    // if (this.offsetTime > 0 || this.scrollStartTime != null) {
      // this.ctxD.clearRect(0,0,this.width,this.height);
    // }
    // else {
      // this.ctxD.clearRect(0,0,0.5*this.width + (this.scrolling?
                          // (Date.now() - this.currentTime)/this.scale
                          // :this.offsetTime/this.scale) + 10,this.height);
    // }
    // getting the current time, which will be at the center of the canvas.
    if (this.timeFrozen) {
      if (!this.scrolling) {
        this.currentTime = this.frozenTime - this.offsetTime;
      }
      else if (this.acceleration != 0) {
        this.currentTime = this.frozenTime - this.offsetTime -
                           this.acceleration * (Date.now() - this.frozenTime) / 100;
      }
    }
    else {
      this.currentTime = Date.now() - this.offsetTime;
    }
    this.lastVisibleTime = this.currentTime + 0.2*this.width*this.scale;
    this.firstVisibleTime = this.lastVisibleTime - this.width*this.scale;

    let i = this.searchIndexForTime(this.lastVisibleTime);
    for (; i >= 0; i--) {
      if (this.globalTiming[i] >= this.firstVisibleTime) {
        this.drawDot((this.globalTiming[i] - this.firstVisibleTime)/this.scale,
                     this.groupedData[this.globalGroup[i]].y,
                     this.groupedData[this.globalGroup[i]].id);
      }
      // No need of going down further as time is already below visible state.
      else {
        break;
      }
    }

    if (this.dotsDrawn == 0 && !this.scrolling && this.offsetTime == 0) {
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
    this.linesDrawn = 0;

    let ([x,endx,y,endy,v] = this.dirtyZone) {
      this.ctxL.clearRect(x-1,y-1,endx-x+12,endy-y+2);
      this.ctxL.clearRect(v - 10,0,20,this.height);
      this.dirtyZone = [5000,0,5000,0,0];
    }
    //this.ctxL.clearRect(0,0,this.currentWidth + 200,this.height);
    // getting the current time, which will be at the center of the canvas.
    let date = Date.now();
    if (this.timeFrozen) {
      if (!this.scrolling) {
        this.currentTime = this.frozenTime - this.offsetTime;
      }
      else if (this.acceleration != 0) {
        this.currentTime = this.frozenTime - this.offsetTime -
                           this.acceleration * (date - this.frozenTime) / 100;
      }
    }
    else {
      this.currentTime = date - this.offsetTime;
    }
    this.firstVisibleTime = this.currentTime - 0.8*this.width*this.scale;
    this.lastVisibleTime = this.firstVisibleTime + this.width*this.scale;

    this.currentWidth = Math.min(0.8*this.width + (this.scrolling? (date -
                                 this.currentTime)/this.scale:(this.timeFrozen?
                                  (date - this.frozenTime + this.offsetTime)/this.scale
                                 :this.offsetTime/this.scale)), this.width);

    let endx,x;
    for each (group in this.groupedData) {
      if (group.y < this.offsetTop || group.y - this.offsetTop > this.width) {
        continue;
      }
      if (group.active && group.timestamps[group.timestamps.length - 1] <= this.firstVisibleTime) {
        this.drawLine(0, group.y, group.id, this.currentWidth);
      }
      else if ((group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_END ||
                group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_START ||
                group.type == NORMALIZED_EVENT_TYPE.CONTINUOUS_EVENT_MID) &&
               group.timestamps[group.timestamps.length - 1] >= this.firstVisibleTime &&
               group.timestamps[0] <= this.lastVisibleTime) {
        x = (Math.max(group.timestamps[0], this.firstVisibleTime) - this.firstVisibleTime)/this.scale;
        if (!group.active) {
          endx = Math.min((group.timestamps[group.timestamps.length - 1] -
                          this.firstVisibleTime)/this.scale, this.currentWidth);
        }
        else {
          endx = this.currentWidth;
        }
        this.drawLine(x,group.y,group.id,endx);
      }
      else if (group.type == NORMALIZED_EVENT_TYPE.REPEATING_EVENT_STOP ||
               group.type == NORMALIZED_EVENT_TYPE.REPEATING_EVENT_START ||
               group.type == NORMALIZED_EVENT_TYPE.REPEATING_EVENT_MID) {
        for (let i = 0; i < group.timestamps.length; i++) {
          if (group.timestamps[i][group.timestamps[i].length - 1] >= this.firstVisibleTime &&
              group.timestamps[i][0] <= this.lastVisibleTime) {
            x = (Math.max(group.timestamps[i][0], this.firstVisibleTime) - this.firstVisibleTime)/this.scale;
            if (!group.active || i < group.timestamps.length - 1) {
              endx = Math.min((group.timestamps[i][group.timestamps[i].length - 1] -
                              this.firstVisibleTime)/this.scale, this.currentWidth);
            }
            else {
              endx = this.currentWidth;
            }
            this.drawLine(x,group.y,group.id,endx);
          }
        }
      }
    }

    // Moving the current time needle to appropriate position.
    this.doc.getElementById("timeline-current-time").style.left = this.currentWidth + "px";

    if (this.linesDrawn == 0 && !this.scrolling && this.offsetTime == 0 &&
        !this.timeFrozen) {
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
  this.startingoffsetTime = null;
  this.infoBoxHidden = false;
  this.tickerGroups = [];

  this._frame = ownerDocument.createElement("iframe");
  this._frame.height = TimelinePreferences.height;
  this._nbox = gBrowser.getNotificationBox(gBrowser.selectedTab.linkedBrowser);
  this._nbox.appendChild(this._splitter);
  this._nbox.appendChild(this._frame);
  this._canvas = null;

  this.createProducersPane = this.createProducersPane.bind(this);
  this.toggleProducersPane = this.toggleProducersPane.bind(this);
  this.toggleInfoBox = this.toggleInfoBox.bind(this);
  this.toggleRecording = this.toggleRecording.bind(this);
  this.toggleFeature = this.toggleFeature.bind(this);
  this.toggleMovement = this.toggleMovement.bind(this);
  this.toggleProducer = this.toggleProducer.bind(this);
  this.toggleProducerBox = this.toggleProducerBox.bind(this);
  this.addGroupBox = this.addGroupBox.bind(this);
  this.handleGroupClick = this.handleGroupClick.bind(this);
  this.handleScroll = this.handleScroll.bind(this);
  this.onProducersScroll = this.onProducersScroll.bind(this);
  this.onCanvasScroll = this.onCanvasScroll.bind(this);
  this.onFrameResize = this.onFrameResize.bind(this);
  this.cleanUI = this.cleanUI.bind(this);
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
    this.playButton = this.$("play");
    this.infoBox = this.$("timeline-infobox");
    this.producersButton = this.$("producers");
    this.infoBoxButton = this.$("infobox");
    this.producersPane = this.$("producers-pane");
    // Attaching events.
    this._frameDoc.defaultView.onresize = this.onFrameResize;
    this.producersPane.onscroll = this.onProducersScroll;
    this.$("canvas-container").addEventListener("MozMousePixelScroll", this.onCanvasScroll, true);
    this.closeButton.addEventListener("command", GraphUI.destroy, true);
    this.playButton.addEventListener("command", this.toggleMovement, true);
    this.recordButton.addEventListener("command", this.toggleRecording, true);
    this.producersButton.addEventListener("command", this.toggleProducersPane, true);
    this.infoBoxButton.addEventListener("command", this.toggleInfoBox, true);
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
    let request = aData.details.log.entries[0].request;
    let featureBox = producerBox.firstChild.nextSibling;
    let urlLabel = this._frameDoc.createElement("label");
    urlLabel.setAttribute("id", aData.groupID.replace(" ", "_") + "-groupbox");
    urlLabel.setAttribute("class", "timeline-groubox");
    urlLabel.setAttribute("groupId", aData.groupID);
    urlLabel.setAttribute("shouldDelete", true);
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
    }
    else {
      this.playButton.setAttribute("checked", true);
      this._canvas.moveToCurrentTime();
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
    if (this.canvasStarted) {
      this._canvas.height = this.$("canvas-container").boxObject.height;
      this._canvas.width = this.$("timeline-content").boxObject.width -
                           (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
    }
  },

  _hideProducersPane: function TV__hideProducersPane()
  {
    this.producersPaneOpened = false;
    this.producersPane.setAttribute("visible", false);
    this.producersPane.collapsed = true;
    if (this.canvasStarted) {
      this._canvas.height = this.$("canvas-container").boxObject.height;
      this._canvas.width = this.$("timeline-content").boxObject.width -
                           (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
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
      this.playButton.setAttribute("checked", true);
      // Starting the canvas.
      if (!this.canvasStarted) {
        this._canvas = new CanvasManager(this._frameDoc);
        this._canvas.height = this.$("canvas-container").boxObject.height;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
        this.$("timeline-current-time").style.left = this._canvas.width*0.8 + "px";
        this.canvasStarted = true;
        this.handleScroll();
      }
      else {
        this._canvas.height = this.$("canvas-container").boxObject.height;
        this._canvas.width = this.$("timeline-content").boxObject.width -
                             (this.producersPaneOpened? this.producersPane.boxObject.width: 0);
        this._canvas.startRendering();
      }
    }
    else {
      GraphUI.stopListening({timelineUIId: GraphUI.id});
      this._canvas.stopRendering();
      try {
        this.playButton.removeAttribute("checked");
      } catch(e) {}
      this.cleanUI();
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

  onCanvasScroll: function TV_onCanvasScroll(aEvent)
  {
    if (aEvent.detail) {
      aEvent.preventDefault();
      this.producersPane.scrollTop = Math.max(0, this._canvas.offsetTop + aEvent.detail);
      this._canvas.offsetTop = this.producersPane.scrollTop;
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
        if (this._canvas.waitForLineData) {
          this._canvas.waitForLineData = false;
          this._canvas.renderLines();
        }
        if (this._canvas.waitForDotData) {
          this._canvas.waitForDotData = false;
          this._canvas.renderDots();
        }
      }.bind(this), 500);
    }
  },

  handleGroupClick: function handleGroupClick(aEvent)
  {
    let group = aEvent.originalTarget;
    if (group.localName == "label" && group.hasAttribute("groupId")) {
      this._canvas.moveGroupInView(group.getAttribute("groupId"));
    }
  },

  /**
   * Adds a short summary of the event in the ticker box.
   *
   * @param object aData
   *        Normalized event data.
   */
  addToTicker: function TV_addToTicker(aData)
  {
    if (this.infoBoxHidden) {
      return;
    }
    if (aData.type != NORMALIZED_EVENT_TYPE.POINT_EVENT &&
        this.tickerGroups.indexOf(aData.groupID) != -1) {
      return;
    }
    let feedItem = this._frameDoc.createElement("vbox");
    feedItem.setAttribute("class", "ticker-feed");
    feedItem.setAttribute("groupId", aData.groupID);
    // The only hard coded part of the code.
    let label1 = this._frameDoc.createElement("label");
    let label2 = this._frameDoc.createElement("label");
    let dateString =  (new Date(aData.time)).getHours() + ":" +
                      (new Date(aData.time)).getMinutes() + ":" +
                      (new Date(aData.time)).getSeconds();
    switch (aData.producer) {
      case "NetworkProducer":
        let request = aData.details.log.entries[0].request;
        label1.setAttribute("value", request.method.toUpperCase() + " " + request.url);
        feedItem.appendChild(label1);
        label2.setAttribute("value", aData.name + " at " + dateString);
        feedItem.appendChild(label2);
        break;

      case "PageEventsProducer":
        if (aData.groupID == "MouseEvent") {
          label1.setAttribute("value", aData.name + " at (" +
                                       aData.details.screenX + "," +
                                       aData.details.screenY + ")");
        }
        else if (aData.groupID == "KeyboardEvent") {
          label1.setAttribute("value", aData.name + ", Key " + aData.details.keyCode);
        }
        else {
          label1.setAttribute("value", aData.name + " at " + dateString)
        }
        feedItem.appendChild(label1);
        if (aData.groupID == "MouseEvent") {
          label2.setAttribute("value", "on Id " + aData.details.target + " at " + dateString);
          feedItem.appendChild(label2);
        }
        else if (aData.groupID == "KeyboardEvent") {
          label2.setAttribute("value", "on Id " + aData.details.target + " at " + dateString);
          feedItem.appendChild(label2);
        }
        break;

      case "MemoryProducer":
        label1.setAttribute("value", aData.name + " at " + dateString);
        feedItem.appendChild(label1);
        break;

      default:
        return;
    }
    this.tickerGroups.push(aData.groupID);
    if (!this.infoBox.firstChild) {
      this.infoBox.appendChild(feedItem);
    }
    else {
      this.infoBox.insertBefore(feedItem, this.infoBox.firstChild);
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
    if (!this._canvas.hasGroup(aData)) {
      this.addGroupBox(aData);
      this._canvas.updateGroupOffset();
    }
    this._canvas.pushData(aData);
    this.addToTicker(aData);
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
    try {
      this.playButton.removeAttribute("checked");
    } catch (ex) {}

    this._canvas.acceleration = this.scrollStartX - aEvent.clientX;
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
   * Handles dragging of the current time vertical line to scroll to previous time.
   */
  handleScroll: function TV_handleScroll()
  {
    this.$("timeline-ruler").addEventListener("mousedown", this._onDragStart, true);
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
      GraphUI.id = "timeline-ui-" + Date.now();
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
          GraphUI.id = "timeline-ui-" + Date.now();
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
