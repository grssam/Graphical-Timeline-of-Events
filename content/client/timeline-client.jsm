/* -*- Mode: javascript; tab-width: 2; indent-tabs-mode: nil; c-basic-offset: 2 -*- */
/* vim: set ft=javascript ts=2 et sw=2 tw=80: */
/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

"use strict";
const Ci = Components.interfaces;
const Cc = Components.classes;
const Cu = Components.utils;
const Cr = Components.results;

var EXPORTED_SYMBOLS = ["DebuggerClient"];

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/NetUtil.jsm");
Cu.import("resource://gre/modules/Services.jsm");

let loader = Cc["@mozilla.org/moz/jssubscript-loader;1"]
  .getService(Ci.mozIJSSubScriptLoader);
loader.loadSubScript("chrome://global/content/devtools/dbg-transport.js");

/**
 * Add simple event notification to a prototype object. Any object that has
 * some use for event notifications or the observer pattern in general can be
 * augmented with the necessary facilities by passing its prototype to this
 * function.
 *
 * @param aProto object
 *        The prototype object that will be modified.
 */
function eventSource(aProto) {
  /**
   * Add a listener to the event source for a given event.
   *
   * @param aName string
   *        The event to listen for, or null to listen to all events.
   * @param aListener function
   *        Called when the event is fired. If the same listener
   *        is added more the once, it will be called once per
   *        addListener call.
   */
  aProto.addListener = function EV_addListener(aName, aListener) {
    if (typeof aListener != "function") {
      return;
    }

    if (!this._listeners) {
      this._listeners = {};
    }

    if (!aName) {
      aName = '*';
    }

    this._getListeners(aName).push(aListener);
  };

  /**
   * Add a listener to the event source for a given event. The
   * listener will be removed after it is called for the first time.
   *
   * @param aName string
   *        The event to listen for, or null to respond to the first event
   *        fired by the object.
   * @param aListener function
   *        Called when the event is fired.
   */
  aProto.addOneTimeListener = function EV_addOneTimeListener(aName, aListener) {
    let self = this;

    let l = function() {
      self.removeListener(aName, l);
      aListener.apply(null, arguments);
    };
    this.addListener(aName, l);
  };

  /**
   * Remove a listener from the event source previously added with
   * addListener().
   *
   * @param aName string
   *        The event name used during addListener to add the listener.
   * @param aListener function
   *        The callback to remove. If addListener was called multiple
   *        times, all instances will be removed.
   */
  aProto.removeListener = function EV_removeListener(aName, aListener) {
    if (!this._listeners || !this._listeners[aName]) {
      return;
    }
    this._listeners[aName] =
      this._listeners[aName].filter(function(l) { return l != aListener });
  };

  /**
   * Returns the listeners for the specified event name. If none are defined it
   * initializes an empty list and returns that.
   *
   * @param aName string
   *        The event name.
   */
  aProto._getListeners = function EV_getListeners(aName) {
    if (aName in this._listeners) {
      return this._listeners[aName];
    }
    this._listeners[aName] = [];
    return this._listeners[aName];
  };

  /**
   * Notify listeners of an event.
   *
   * @param aName string
   *        The event to fire.
   * @param arguments
   *        All arguments will be passed along to the listeners,
   *        including the name argument.
   */
  aProto.notify = function EV_notify() {
    if (!this._listeners) {
      return;
    }

    let name = arguments[0];
    let listeners = this._getListeners(name).slice(0);
    if (this._listeners['*']) {
      listeners.concat(this._listeners['*']);
    }

    for each (let listener in listeners) {
      try {
        listener.apply(null, arguments);
      } catch (e) {
      }
    }
  }
}

/**
 * Set of protocol messages that affect thread state, and the
 * state the actor is in after each message.
 */
const ThreadStateTypes = {
  "paused": "paused",
  "resumed": "attached",
  "detached": "detached"
};

/**
 * Set of protocol messages that are sent by the server without a prior request
 * by the client.
 */
const UnsolicitedNotifications = {
  "newNormalizedData": "newNormalizedData",
  "UIUpdate": "UIUpdate",
  "pageReload": "pageReload"
};

/**
 * Creates a client for the remote debugging protocol server. This client
 * provides the means to communicate with the server and exchange the messages
 * required by the protocol in a traditional JavaScript API.
 */
function DebuggerClient(aTransport)
{
  this._transport = aTransport;
  this._transport.hooks = this;
  this._tabClients = {};

  this._pendingRequests = [];
  this._activeRequests = {};
  this._eventsEnabled = true;
}

DebuggerClient.prototype = {
  /**
   * Connect to the server and start exchanging protocol messages.
   *
   * @param aOnConnected function
   *        If specified, will be called when the greeting packet is
   *        received from the debugging server.
   */
  connect: function DC_connect(aOnConnected) {
    if (aOnConnected) {
      this.addOneTimeListener("connected", function(aName, aApplicationType, aTraits) {
        aOnConnected(aApplicationType, aTraits);
      });
    }

    this._transport.ready();
  },

  /**
   * Shut down communication with the debugging server.
   *
   * @param aOnClosed function
   *        If specified, will be called when the debugging connection
   *        has been closed.
   */
  close: function DC_close(aOnClosed) {
    // Disable detach event notifications, because event handlers will be in a
    // cleared scope by the time they run.
    this._eventsEnabled = false;

    if (aOnClosed) {
      this.addOneTimeListener('closed', function(aEvent) {
        aOnClosed();
      });
    }

    let closeTransport = function _closeTransport() {
      this._transport.close();
      this._transport = null;
    }.bind(this);

    let detachTab = function _detachTab() {
      if (this.activeTab) {
        this.activeTab.detach(closeTransport);
      } else {
        closeTransport();
      }
    }.bind(this);

    if (this.activeThread) {
      this.activeThread.detach(detachTab);
    } else {
      detachTab();
    }
  },

  /**
   * List the open tabs.
   *
   * @param function aOnResponse
   *        Called with the response packet.
   */
  listTabs: function DC_listTabs(aOnResponse) {
    let packet = { to: "root", type: "listTabs" };
    this.request(packet, function(aResponse) {
      aOnResponse(aResponse);
    });
  },

  /**
   * Send a request to the debugging server.
   *
   * @param aRequest object
   *        A JSON packet to send to the debugging server.
   * @param aOnResponse function
   *        If specified, will be called with the response packet when
   *        debugging server responds.
   */
  request: function DC_request(aRequest, aOnResponse) {
    if (!this._connected) {
      throw Error("Have not yet received a hello packet from the server.");
    }
    if (!aRequest.to) {
      let type = aRequest.type || "";
      throw Error("'" + type + "' request packet has no destination.");
    }

    this._pendingRequests.push({ to: aRequest.to,
                                 request: aRequest,
                                 onResponse: aOnResponse });
    this._sendRequests();
  },

  /**
   * Send pending requests to any actors that don't already have an
   * active request.
   */
  _sendRequests: function DC_sendRequests() {
    let self = this;
    this._pendingRequests = this._pendingRequests.filter(function(request) {
      if (request.to in self._activeRequests) {
        return true;
      }

      self._activeRequests[request.to] = request;
      self._transport.send(request.request);

      return false;
    });
  },

  // Transport hooks.

  /**
   * Called by DebuggerTransport to dispatch incoming packets as appropriate.
   *
   * @param aPacket object
   *        The incoming packet.
   */
  onPacket: function DC_onPacket(aPacket) {
    if (!this._connected) {
      // Hello packet.
      this._connected = true;
      this.notify("connected",
                  aPacket.applicationType,
                  aPacket.traits);
      return;
    }

    try {
      if (!aPacket.from) {
        Cu.reportError("Server did not specify an actor, dropping packet: " +
                       JSON.stringify(aPacket));
        return;
      }

      let onResponse;
      // Don't count unsolicited notifications or pauses as responses.
      if (aPacket.from in this._activeRequests &&
          !(aPacket.type in UnsolicitedNotifications)) {
        onResponse = this._activeRequests[aPacket.from].onResponse;
        delete this._activeRequests[aPacket.from];
      }

      this.notify(aPacket.type, aPacket);

      if (onResponse) {
        onResponse(aPacket);
      }
    } catch(ex) {
    }

    this._sendRequests();
  },

  /**
   * Called by DebuggerTransport when the underlying stream is closed.
   *
   * @param aStatus nsresult
   *        The status code that corresponds to the reason for closing
   *        the stream.
   */
  onClosed: function DC_onClosed(aStatus) {
    this.notify("closed");
  },
}

eventSource(DebuggerClient.prototype);
