/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/Services.jsm");

function DataSinkActor(aConnection) {
  this.conn = aConnection;
}

DataSinkActor.prototype =
{
  actorPrefix: "dataSink",

  conn: null,

  grip: function()
  {
    return {
      actor: this.actorID
    };
  },

  disconnect: function()
  {
    this.onDestroy();
  },

  sendPacket: function DSA_sendPacket(aDetails)
  {
    let {messageData, messageType} = aDetails;
    let packet = {
      from: this.actorID,
      type: messageType,
      message: messageData
    };
    this.conn.send(packet);
  },

  onPing: function DSA_onPing(aRequest)
  {
    return DataSink.replyToPing(aRequest);
  },

  onInit: function DSA_onInit(aRequest)
  {
    try {
      if (DataSink && !DataSink.initiated) {
        // Enable the below line when there is a way to trick UnsolicitedNotifications.
        // DataSink.sendMessage = DataSink.sendMessage.bind(DataSink, this.sendPacket);
      }
    } catch (ex) {
      Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
    }
    return DataSink.init(aRequest);
  },

  onDestroy: function DSA_onDestroy(aRequest)
  {
    let toReturn = DataSink.destroy(aRequest);
    try {
      Components.utils.unload("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Components.utils.unload("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
    } catch (e) {}
    try {
      delete global.DataSink;
      delete global.NetworkProducer;
      delete global.PageEventsProducer;
      delete global.MemoryProducer;
    } catch (e) {}
    return toReturn;
  },

  onEnableFeatures: function DSA_onEnableFeatures(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return Packets.UINotRegistered;
    }
    return DataSink.enableFeatures(aRequest.producerId, aRequest.features);
    //DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onDisableFeatures: function DSA_onDisableFeatures(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return Packets.UINotRegistered;
    }
    return DataSink.disableFeatures(aRequest.producerId, aRequest.features);
    //DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStartProducer: function DSA_onStartProducer(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return Packets.UINotRegistered;
    }
    return DataSink.startProducer(aRequest.producerId, aRequest.features);
    //DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStopProducer: function DSA_onStopProducer(aRequest)
  {
    if (!aRequest.timelineUIId ||
        DataSink.registeredUI.indexOf(aRequest.timelineUIId) == -1) {
      return Packets.UINotRegistered;
    }
    return DataSink.stopProducer(aRequest.producerId);
    //DataSink.sendUpdateNotification(aRequest.timelineUIId);
  },

  onStartRecording: function DSA_onStartRecording(aRequest)
  {
    try {
      if (DataSink && !DataSink.initiated) {
        // Enable the below line when there is a way to trick UnsolicitedNotifications.
        // DataSink.sendMessage = DataSink.sendMessage.bind(DataSink, this.sendPacket);
      }
    } catch (ex) {
      Cu.import("chrome://graphical-timeline/content/producers/NetworkProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/producers/PageEventsProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/producers/MemoryProducer.jsm");
      Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");
    }
    return DataSink.startListening(aRequest);
  },

  onStopRecording: function DSA_onStopRecording(aRequest)
  {
    return DataSink.stopListening(aRequest);
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
