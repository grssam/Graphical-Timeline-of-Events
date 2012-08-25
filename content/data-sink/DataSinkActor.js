/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

function DataSinkActor(aConnection) {
  this.conn = aConnection;
}

DataSinkActor.prototype =
{
  actorPrefix: "dataSink",

  grip: function()
  {
    return {
      actor: this.actorID
    };
  },

  disconnect: function()
  {
    DataSink.destroy();
  },

  onPing: function DSA_onPing(aRequest)
  {
    DataSink.replyToPing(aRequest);
  },

  onInit: function DSA_onInit(aRequest)
  {
    DataSink.init(aRequest);
  },

  onDestroy: function DSA_onDestroy(aRequest)
  {
    DataSink.destroy(aRequest);
  },

  onEnableFeatures: function DSA_onEnableFeatures(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return;
    }
    DataSink.enableFeatures(aRequest.producerId, aRequest.features);
    DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onDisableFeatures: function DSA_onDisableFeatures(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return;
    }
    DataSink.disableFeatures(aRequest.producerId, aRequest.features);
    DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStartProducer: function DSA_onStartProducer(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return;
    }
    DataSink.startProducer(aRequest.producerId, aRequest.features);
    DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStopProducer: function DSA_onStopProducer(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return;
    }
    DataSink.stopProducer(aRequest.producerId);
    DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStartRecording: function DSA_onStartRecording(aRequest)
  {
    DataSink.startListening(aRequest);
  },

  onStopRecording: function DSA_onStopRecording(aRequest)
  {
    DataSink.stopListening(aRequest);
  }
};

/**
* Request type definitions.
*/
DataSinkActor.prototype.requestTypes =
{
  "ping": DataSinkActor.prototype.onPing,
  "init": DataSinkActor.prototype.onInit,
  "destroy": DataSinkActor.prototype.onDestroy,
  "enableFeatures": DataSinkActor.prototype.onEnableFeatures,
  "disableFeatures": DataSinkActor.prototype.onDisableFeatures,
  "startProducer": DataSinkActor.prototype.onStartProducer,
  "stopProducer": DataSinkActor.prototype.onStopProducer,
  "startRecording": DataSinkActor.prototype.onStartRecording,
  "stopRecording": DataSinkActor.prototype.onStopRecording
};

DebuggerServer.addGlobalActor(DataSinkActor, "dataSinkActor");
