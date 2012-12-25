/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

var EXPORTED_SYMBOLS = ["TimelinePanel"];

Cu.import("resource:///modules/devtools/EventEmitter.jsm");
Cu.import("resource://gre/modules/commonjs/promise/core.js");
let global = {};
Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);

function TimelinePanel(iframeWindow, toolbox) {
  this._toolbox = toolbox;
  this.panelWin = iframeWindow;

  // import the timeline jsm to map functions
  this.window = Services.wm.getMostRecentWindow("navigator:browser");
  Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
  Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);
  global.DataSink.addRemoteListener(this.window);

  let parentDoc = iframeWindow.document.defaultView.parent.document;
  let iframe = parentDoc.getElementById("toolbox-panel-iframe-timeline");
  global.Timeline.init(null, iframe);

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
      Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
      delete global.DataSink;
      delete global.NetworkProducer;
      delete global.PageEventsProducer;
      delete global.MemoryProducer;
      global.Timeline = null;
      delete global.Timeline;
      global = null;
      global = {};
      Cu.import("chrome://graphical-timeline/content/frontend/timeline.jsm", global);
    } catch (e) {Components.utils.reportError(e);}Components.utils.reportError('done');
    return Promise.resolve(null);
  },
};
