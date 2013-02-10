/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["TimelinePanel"];

Cu.import("resource:///modules/devtools/EventEmitter.jsm");
try {
  Cu.import("resource://gre/modules/commonjs/promise/core.js");
} catch (e) {
  Cu.import("resource://gre/modules/commonjs/sdk/core/promise.js");
}
let global = {};
Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);

function TimelinePanel(iframeWindow, toolbox, callback) {
  this._toolbox = toolbox;
  this.panelWin = iframeWindow;
  this.callback = callback;

  // import the timeline jsm to map functions
  this.window = toolbox._target.tab.ownerDocument.defaultView;
  Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
  global.DataSink.addRemoteListener(this.window);

  let parentDoc = iframeWindow.document.defaultView.parent.document;
  let iframe = parentDoc.getElementById("toolbox-panel-iframe-timeline");
  global.Timeline.init(null, iframe, toolbox);

  EventEmitter.decorate(this);
}

TimelinePanel.prototype = {
  // DevToolPanel API
  get target() this._toolbox.target,

  get isReady() this._isReady,

  open: function() {
    let deferred = Promise.defer();
    this._isReady = true;
    this.emit("ready");
    deferred.resolve(this);
    return deferred.promise;
  },

  destroy: function() {
    global.Timeline.destroy();
    global.DataSink.removeRemoteListener(this.window);
    this.window = null;
    try {
      global.DataSink = null;
      Components.utils.unload("chrome://graphical-timeline/content/frontend/timeline.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
      delete global.DataSink;
      delete global.NetworkProducer;
      delete global.PageEventsProducer;
      delete global.MemoryProducer;
      global.Timeline = null;
      global.Timeline = null;
      global.Timeline = null;
      delete global.Timeline;
      global = null;
      global = {};
      Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);
    } catch (e) {}
    if (this.callback) {
      this.callback();
      this.callback = null;
    }
    return Promise.resolve(null);
  },
};
