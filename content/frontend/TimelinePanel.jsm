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
Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm", global);
Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm", global);
Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm", global);
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm", global);

function TimelinePanel(iframeWindow, toolbox, callback) {
  this._toolbox = toolbox;
  this.panelWin = iframeWindow;
  this.callback = callback;

  // import the timeline jsm to map functions
  if (toolbox._target.tab) {
    this.window = toolbox._target.tab.ownerDocument.defaultView;
  }
  else if (toolbox._target.window) {
    this.window = toolbox._target.window;
  }
  global.DataSink.addRemoteListener(this.window);

  let parentDoc = iframeWindow.document.defaultView.parent.document;
  let iframe = parentDoc.getElementById("toolbox-panel-iframe-timeline");
  this.Timeline = new global.Timeline(null, iframe, toolbox);

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
    this.Timeline.destroy();
    global.DataSink.removeRemoteListener(this.window);
    this.window = null;
    this.Timeline = null;
    if (this.callback) {
      this.callback();
      this.callback = null;
    }
    return Promise.resolve(null);
  },
};
