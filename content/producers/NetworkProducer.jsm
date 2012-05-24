/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/NetworkHelper.jsm");
Cu.import("chrome://graphical-timeline/content/data-sink/DataSink.jsm");

var EXPORTED_SYMBOLS = ["NetworkProducer"];

XPCOMUtils.defineLazyServiceGetter(this, "activityDistributor",
                                   "@mozilla.org/network/http-activity-distributor;1",
                                   "nsIHttpActivityDistributor");

// The maximum uint32 value.
const PR_UINT32_MAX = 4294967295;

// The pref prefix for network producer filters.
const PREFS_PREFIX = "devtools.graphical_timeline.producers.network.";

/**
 * The network response listener implements the nsIStreamListener and
 * nsIRequestObserver interface. Used within the HS_httpObserverFactory function
 * to get the response body of requests.
 *
 * The code is mostly based on code listings from:
 *
 *   http://www.softwareishard.com/blog/firebug/
 *     nsitraceablechannel-intercept-http-traffic/
 *
 * @constructor
 * @param object aHttpActivity
 *        HttpActivity object associated with this request (see
 *        HS_httpObserverFactory). As the response is done, the response header,
 *        body and status is stored on aHttpActivity.
 */
function NetworkResponseListener(aHttpActivity) {
  this.receivedData = "";
  this.httpActivity = aHttpActivity;
}

NetworkResponseListener.prototype =
{
  QueryInterface:
    XPCOMUtils.generateQI([Ci.nsIStreamListener, Ci.nsIInputStreamCallback,
                           Ci.nsIRequestObserver, Ci.nsISupports]),

  /**
   * This NetworkResponseListener tracks the NetworkProducer.openResponses object
   * to find the associated uncached headers.
   * @private
   */
  _foundOpenResponse: false,

  /**
   * The response will be written into the outputStream of this nsIPipe.
   * Both ends of the pipe must be blocking.
   */
  sink: null,

  /**
   * The HttpActivity object associated with this response.
   */
  httpActivity: null,

  /**
   * Stores the received data as a string.
   */
  receivedData: null,

  /**
   * The nsIRequest we are started for.
   */
  request: null,

  /**
   * Set the async listener for the given nsIAsyncInputStream. This allows us to
   * wait asynchronously for any data coming from the stream.
   *
   * @param nsIAsyncInputStream aStream
   *        The input stream from where we are waiting for data to come in.
   *
   * @param nsIInputStreamCallback aListener
   *        The input stream callback you want. This is an object that must have
   *        the onInputStreamReady() method. If the argument is null, then the
   *        current callback is removed.
   *
   * @returns void
   */
  setAsyncListener: function NRL_setAsyncListener(aStream, aListener)
  {
    // Asynchronously wait for the stream to be readable or closed.
    aStream.asyncWait(aListener, 0, 0, Services.tm.mainThread);
  },

  /**
   * See documentation at
   * https://developer.mozilla.org/En/NsIRequestObserver
   *
   * @param nsIRequest aRequest
   */
  onStartRequest: function NRL_onStartRequest(aRequest)
  {
    this.request = aRequest;
    this._findOpenResponse();
    // Asynchronously wait for the data coming from the request.
    this.setAsyncListener(this.sink.inputStream, this);
  },

  /**
   * Handle the onStopRequest by storing the response header is stored on the
   * httpActivity object. The sink output stream is also closed.
   *
   * For more documentation about nsIRequestObserver go to:
   * https://developer.mozilla.org/En/NsIRequestObserver
   */
  onStopRequest: function NRL_onStopRequest()
  {
    this._findOpenResponse();
    this.sink.outputStream.close();
  },

  /**
  * Find the open response object associated to the current request. The
  * NetworkProducer.httpResponseExaminer() method saves the response headers in
  * NetworkProducer.openResponses. This method takes the data from the open
  * response object and puts it into the HTTP activity object, then sends it to
  * the remote Web Console instance.
  *
  * @private
  */
  _findOpenResponse: function NNRL__findOpenResponse()
  {
    if (this._foundOpenResponse) {
      return;
    }

    let openResponse = null;

    for each (let item in NetworkProducer.openResponses) {
      if (item.channel === this.httpActivity.channel) {
        openResponse = item;
        break;
      }
    }

    if (!openResponse) {
      return;
    }
    this._foundOpenResponse = true;

    let logResponse = this.httpActivity.log.entries[0].response;
    logResponse.headers = openResponse.headers;
    logResponse.httpVersion = openResponse.httpVersion;
    logResponse.status = openResponse.status;
    logResponse.statusText = openResponse.statusText;
    if (openResponse.cookies) {
      logResponse.cookies = openResponse.cookies;
    }
    if (openResponse.contentType) {
      logResponse.contentType = openResponse.contentType;
    }

    delete NetworkProducer.openResponses[openResponse.id];

    this.httpActivity.meta.stages.push("http-on-examine-response");
    NetworkProducer.sendActivity(this.httpActivity);
  },

  /**
   * Clean up the response listener once the response input stream is closed.
   * This is called from onStopRequest() or from onInputStreamReady() when the
   * stream is closed.
   *
   * @returns void
   */
  onStreamClose: function NRL_onStreamClose()
  {
    if (!this.httpActivity) {
      return;
    }
    // Remove our listener from the request input stream.
    this.setAsyncListener(this.sink.inputStream, null);

    this._findOpenResponse();

    this.httpActivity.meta.stages.push("REQUEST_STOP");

    this.receivedData = "";

    NetworkProducer.sendActivity(this.httpActivity);

    this.httpActivity.channel = null;
    this.httpActivity = null;
    this.sink = null;
    this.inputStream = null;
    this.requtStream = null;
  },

  /**
   * The nsIInputStreamCallback for when the request input stream is ready -
   * either it has more data or it is closed.
   *
   * @param nsIAsyncInputStream aStream
   *        The sink input stream from which data is coming.
   *
   * @returns void
   */
  onInputStreamReady: function NRL_onInputStreamReady(aStream)
  {
    if (!(aStream instanceof Ci.nsIAsyncInputStream) || !this.httpActivity) {
      return;
    }
    
    let available = -1;
    try {
      // This may throw if the stream is closed normally or due to an error.
      available = aStream.available();
    }
    catch (ex) { }
    
    if (available != -1) {
      this.setAsyncListener(aStream, this);
    }
    else {
      this.onStreamClose();
    }
  },
};

/**
 * The network producer uses the nsIHttpActivityDistributor to monitor network
 * requests. The nsIObserverService is also used for monitoring
 * http-on-examine-response notifications. All network request information is
 * routed to the remote Web Console.
 *
 * @param [object] aWindowList
 *        List of content windows for which NetworkProducer will listen for
 *        network activity.
 */
function NetworkProducer(aWindowList) {

  this.httpTransactionCodes = {
    0x5001: "REQUEST_HEADER",
    0x5002: "REQUEST_BODY_SENT",
    0x5003: "RESPONSE_START",
    0x5004: "RESPONSE_HEADER",
    0x5005: "RESPONSE_COMPLETE",
    0x5006: "TRANSACTION_CLOSE",

    0x804b0003: "STATUS_RESOLVING",
    0x804b000b: "STATUS_RESOLVED",
    0x804b0007: "STATUS_CONNECTING_TO",
    0x804b0004: "STATUS_CONNECTED_TO",
    0x804b0005: "STATUS_SENDING_TO",
    0x804b000a: "STATUS_WAITING_FOR",
    0x804b0006: "STATUS_RECEIVING_FROM"
  };

  this.harCreator = {
    name: Services.appinfo.name + " - Graphical Timeline",
    version: Services.appinfo.version,
  };

  this._sequence = 0;

  // Network response bodies are piped through a buffer of the given size (in
  // bytes).
  this.responsePipeSegmentSize = null;

  this.openRequests = null;
  this.openResponses = null;
  this.progressListener = null;

  /**
   * List of content windows that this producer is listening to.
   */
  this.listeningWindows = aWindowList;

  this.init();
}

NetworkProducer.prototype =
{
  /**
   * Getter for a unique ID for the Network Producer.
   */
  get sequenceId() "NetworkProducer-" + (++this._sequence),

  /**
   * The network producer initializer.
   */
  init: function NP_init()
  {
    this.responsePipeSegmentSize = Services.prefs
                                   .getIntPref("network.buffer.cache.size");

    this.openRequests = {};
    this.openResponses = {};
    this.listeningWindows = aWindowList;

    activityDistributor.addObserver(this);

    Services.obs.addObserver(this.httpResponseExaminer,
                             "http-on-examine-response", false);

  },

  /**
   * Starts listening to network activity for the given content windows.
   *
   * @param [object] aWindowList
   *        List of content windows for which NetworkProducer will start
   *        listening for network activity.
   */
  addWindows: function NP_addWindows(aWindowList)
  {
    for (let window in aWindowList) {
      this.listeningWindows.push(window);
    }
  },

  /**
   * Stops listening to network activity for the given windows.
   *
   * @param [object] aWindowList
   *        List of content windows for which NetworkProducer will stop
   *        listening for network activity.
   */
  removeWindows: function NP_removeWindows(aWindowList)
  {
    for (let window in aWindowList) {
      this.listeningWindows.slice(this.listeningWindows.indexOf(window), 1);
    }
  },

  /**
   * Observe notifications for the http-on-examine-response topic, coming from
   * the nsIObserverService.
   *
   * @param nsIHttpChannel aSubject
   * @param string aTopic
   * @returns void
   */
  httpResponseExaminer: function NP_httpResponseExaminer(aSubject, aTopic)
  {
    // The httpResponseExaminer is used to retrieve the uncached response
    // headers. The data retrieved is stored in openResponses. The
    // NetworkResponseListener is responsible with updating the httpActivity
    // object with the data from the new object in openResponses.

    if (aTopic != "http-on-examine-response" ||
        !(aSubject instanceof Ci.nsIHttpChannel)) {
      return;
    }

    let channel = aSubject.QueryInterface(Ci.nsIHttpChannel);
    // Try to get the source window of the request.
    let win = NetworkHelper.getWindowForRequest(channel);
    if (!win) {
      return;
    }

    let response = {
      id: this.sequenceId,
      channel: channel,
      headers: [],
      cookies: [],
    };

    let setCookieHeader = null;
    let contentType = null;

    channel.visitResponseHeaders({
      visitHeader: function NP_visitHeader(aName, aValue) {
        let lowerName = aName.toLowerCase();
        if (lowerName == "set-cookie") {
          setCookieHeader = aValue;
        }
        else if (lowerName == "content-type") {
          contentType = aValue;
        }
        response.headers.push({ name: aName, value: aValue });
      }
    });

    if (!response.headers.length) {
      return; // No need to continue.
    }

    if (setCookieHeader) {
      response.cookies = NetworkHelper.parseSetCookieHeader(setCookieHeader);
    }
    if (contentType) {
      response.contentType = contentType;
    }

    // Determine the HTTP version.
    let httpVersionMaj = {};
    let httpVersionMin = {};

    channel.QueryInterface(Ci.nsIHttpChannelInternal);
    channel.getResponseVersion(httpVersionMaj, httpVersionMin);

    response.status = channel.responseStatus;
    response.statusText = channel.responseStatusText;
    response.httpVersion = "HTTP/" + httpVersionMaj.value + "." +
                                     httpVersionMin.value;

    NetworkProducer.openResponses[response.id] = response;
  },

  /**
   * Begin observing HTTP traffic that originates inside the browser.
   *
   * @see https://developer.mozilla.org/en/XPCOM_Interface_Reference/nsIHttpActivityObserver
   *
   * @param nsIHttpChannel aChannel
   * @param number aActivityType
   * @param number aActivitySubtype
   * @param number aTimestamp
   * @param number aExtraSizeData
   * @param string aExtraStringData
   */
  observeActivity:
  function NP_observeActivity(aChannel, aActivityType, aActivitySubtype,
                              aTimestamp, aExtraSizeData, aExtraStringData)
  {
    if (aActivityType != activityDistributor.ACTIVITY_TYPE_HTTP_TRANSACTION &&
        aActivityType != activityDistributor.ACTIVITY_TYPE_SOCKET_TRANSPORT) {
      return;
    }

    if (!(aChannel instanceof Ci.nsIHttpChannel)) {
      return;
    }

    aChannel = aChannel.QueryInterface(Ci.nsIHttpChannel);

    if (aActivitySubtype ==
        activityDistributor.ACTIVITY_SUBTYPE_REQUEST_HEADER) {
      this._onRequestHeader(aChannel, aTimestamp, aExtraStringData);
      return;
    }

    // Iterate over all currently ongoing requests. If aChannel can't
    // be found within them, then exit this function.
    let httpActivity = null;
    for each (let item in this.openRequests) {
      if (item.channel === aChannel) {
        httpActivity = item;
        break;
      }
    }

    if (!httpActivity) {
      return;
    }

    let transCodes = this.httpTransactionCodes;

    // Store the time information for this activity subtype.
    if (aActivitySubtype in transCodes) {
      let stage = transCodes[aActivitySubtype];
      if (stage in httpActivity.timings) {
        httpActivity.timings[stage].last = aTimestamp;
      }
      else {
        httpActivity.meta.stages.push(stage);
        httpActivity.timings[stage] = {
          first: aTimestamp,
          last: aTimestamp,
        };
      }
    }

    switch (aActivitySubtype) {
      case activityDistributor.ACTIVITY_SUBTYPE_REQUEST_BODY_SENT:
        this._onRequestBodySent(httpActivity);
        break;
      case activityDistributor.ACTIVITY_SUBTYPE_RESPONSE_HEADER:
        this._onResponseHeader(httpActivity, aExtraStringData);
        break;
      case activityDistributor.ACTIVITY_SUBTYPE_TRANSACTION_CLOSE:
        this._onTransactionClose(httpActivity);
        break;
      // Directly fire an event for the rest of the http sub types.
      case activityDistributor.ACTIVITY_SUBTYPE_RESPONSE_START:
      case activityDistributor.ACTIVITY_SUBTYPE_RESPONSE_COMPLETE:
        this.sendActivity(httpActivity);
        break;
      default:
        break;
    }
  },

  /**
   * Handler for ACTIVITY_SUBTYPE_REQUEST_HEADER. When a request starts the
   * headers are sent to the server. This method creates the |httpActivity|
   * object where we store the request and response information that is
   * collected through its lifetime.
   *
   * @private
   * @param nsIHttpChannel aChannel
   * @param number aTimestamp
   * @param string aExtraStringData
   * @return void
   */
  _onRequestHeader:
  function NP__onRequestHeader(aChannel, aTimestamp, aExtraStringData)
  {
    // Try to get the source window of the request.
    let win = NetworkHelper.getWindowForRequest(aChannel);
    if (!win || this.listeningWindows.indexOf(win) == -1) {
      return;
    }

    let httpActivity = this.createActivityObject(aChannel);
    httpActivity.charset = win.document.characterSet; // see NP__onRequestBodySent()
    httpActivity.meta.stages.push("REQUEST_HEADER"); // activity stage (aActivitySubtype)

    httpActivity.timings.REQUEST_HEADER = {
      first: aTimestamp,
      last: aTimestamp
    };

    let entry = httpActivity.log.entries[0];
    entry.startedDateTime = new Date(Math.round(aTimestamp / 1000)).toISOString();

    let request = httpActivity.log.entries[0].request;

    let cookieHeader = null;

    // Copy the request header data.
    aChannel.visitRequestHeaders({
      visitHeader: function NP__visitHeader(aName, aValue)
      {
        if (aName == "Cookie") {
          cookieHeader = aValue;
        }
        request.headers.push({ name: aName, value: aValue });
      }
    });

    if (cookieHeader) {
      request.cookies = NetworkHelper.parseCookieHeader(cookieHeader);
    }

    // Determine the HTTP version.
    let httpVersionMaj = {};
    let httpVersionMin = {};

    aChannel.QueryInterface(Ci.nsIHttpChannelInternal);
    aChannel.getRequestVersion(httpVersionMaj, httpVersionMin);

    request.httpVersion = "HTTP/" + httpVersionMaj.value + "." +
                                    httpVersionMin.value;

    request.headersSize = aExtraStringData.length;

    this._setupResponseListener(httpActivity);

    this.openRequests[httpActivity.id] = httpActivity;

    this.sendActivity(httpActivity);
  },

  /**
   * Create the empty HTTP activity object. This object is used for storing all
   * the request and response information.
   *
   * This is a HAR-like object. Conformance to the spec is not guaranteed at
   * this point.
   *
   * TODO: Bug 708717 - Add support for network log export to HAR
   *
   * @see http://www.softwareishard.com/blog/har-12-spec
   * @param nsIHttpChannel aChannel
   *        The HTTP channel for which the HTTP activity object is created.
   * @return object
   *         The new HTTP activity object.
   */
  createActivityObject: function NP_createActivityObject(aChannel)
  {
    return {
      id: this.sequenceId,
      contentWindow: NetworkHelper.getWindowForRequest(aChannel),
      channel: aChannel,
      charset: null, // see NP__onRequestHeader()
      meta: { // holds metadata about the activity object
        stages: [], // activity stages (aActivitySubtype)
      },
      timings: {}, // internal timing information, see NP_observeActivity()
      log: { // HAR-like object
        version: "1.2",
        creator: this.harCreator,
        // missing |browser| and |pages|
        entries: [{  // we only track one entry at a time
          connection: this.sequenceId, // connection ID
          startedDateTime: 0, // see NP__onRequestHeader()
          time: 0, // see NP__setupHarTimings()
          // missing |serverIPAddress| and |cache|
          request: {
            method: aChannel.requestMethod,
            url: aChannel.URI.spec,
            httpVersion: "", // see NP__onRequestHeader()
            headers: [], // see NP__onRequestHeader()
            cookies: [], // see NP__onRequestHeader()
            queryString: [], // never set
            headersSize: -1, // see NP__onRequestHeader()
            bodySize: -1, // see NP__onRequestBodySent()
            postData: null, // see NP__onRequestBodySent()
          },
          response: {
            status: 0, // see NP__onResponseHeader()
            statusText: "", // see NP__onResponseHeader()
            httpVersion: "", // see NP__onResponseHeader()
            headers: [], // see NP_httpResponseExaminer()
            cookies: [], // see NP_httpResponseExaminer()
            content: null, // see NNRL_onStreamClose()
            redirectURL: "", // never set
            headersSize: -1, // see NP__onResponseHeader()
            bodySize: -1, // see NNRL_onStreamClose()
          },
          timings: {}, // see NP__setupHarTimings()
        }],
      },
    };
  },

  /**
   * Setup the network response listener for the given HTTP activity. The
   * NetworkResponseListener is responsible for storing the response body.
   *
   * @private
   * @param object aHttpActivity
   *        The HTTP activity object we are tracking.
   */
  _setupResponseListener: function NP__setupResponseListener(aHttpActivity)
  {
    let channel = aHttpActivity.channel;
    channel.QueryInterface(Ci.nsITraceableChannel);

    // The response will be written into the outputStream of this pipe.
    // This allows us to buffer the data we are receiving and read it
    // asynchronously.
    // Both ends of the pipe must be blocking.
    let sink = Cc["@mozilla.org/pipe;1"].createInstance(Ci.nsIPipe);

    // The streams need to be blocking because this is required by the
    // stream tee.
    sink.init(false, false, this.responsePipeSegmentSize, PR_UINT32_MAX, null);

    // Add listener for the response body.
    let newListener = new NetworkResponseListener(aHttpActivity);

    // Remember the input stream, so it isn't released by GC.
    newListener.inputStream = sink.inputStream;
    newListener.sink = sink;

    let tee = Cc["@mozilla.org/network/stream-listener-tee;1"].
              createInstance(Ci.nsIStreamListenerTee);

    let originalListener = channel.setNewListener(tee);

    tee.init(originalListener, sink.outputStream, newListener);
  },

  /**
   * Add an HTTP activity object to the data sink to send it to the
   * remote graph.
   * A WebConsole:NetworkActivity message is sent. The message holds two
   * properties:
   *   - meta - the |aHttpActivity.meta| object.
   *   - log - the |aHttpActivity.log| object.
   *
   * @param object aHttpActivity
   *        The HTTP activity object you want to send.
   */
  sendActivity: function NP_sendActivity(aHttpActivity)
  {
    let tabId = null;
    let window = aHttpActivity.contentWindow;
    // Get the chrome window associated with the content window
    let chromeWindow = window.QueryInterface(Ci.nsIInterfaceRequestor)
                             .getInterface(Ci.nsIWebNavigation)
                             .QueryInterface(Ci.nsIDocShell)
                             .chromeEventHandler
                             .ownerDocument.defaultView;
    // Get the tab indexassociated with the content window
    let tabIndex = chromeWindow.gBrowser
      .getBrowserIndexForDocument(window.document);
    // Get the unique tab id associated with the tab
    try {
      tabId = chromeWindow.gBrowser.tabs[tabIndex].linkedPanel;
    } catch (ex) {}

    let currentStage =
      aHttpActivity.meta.stages[aHttpActivity.meta.stages.length - 1];

    let time = aHttpActivity.timings[currentStage].first;

    let eventType = null;
    if (currentStage == "REQUEST_HEADER") {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_START;
    }
    else if (currentStage == "TRANSACTION_CLOSE") {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_END;
    }
    else {
      eventType = DataSink.NormalizedEventType.CONTINUOUS_EVENT_MID;
    }

    DataSink.addEvent("Producers:NetworkProducer", {
      type: eventType,
      name: currentStage,
      groupID: aHttpActivity.id,
      time: time,
      details: {
        tabID: tabID,
        meta: aHttpActivity.meta,
        log: aHttpActivity.log,
      }
    });
  },

  /**
   * Handler for ACTIVITY_SUBTYPE_REQUEST_BODY_SENT.
   *
   * @private
   * @param object aHttpActivity
   * The HTTP activity object we are working with.
   */
  _onRequestBodySent: function NM__onRequestBodySent(aHttpActivity)
  {
    if (this.listeningWindows.indexOf(aHttpActivity.contentWindow) == -1) {
      return;
    }

    let request = aHttpActivity.log.entries[0].request;

    let sentBody = NetworkHelper
      .readPostTextFromRequest(aHttpActivity.channel,
                               aHttpActivity.charset);

    if (!sentBody) {
      return;
    }

    request.postData = {
      mimeType: "", // never set
      params: [], // never set
      text: sentBody,
    };

    request.bodySize = sentBody.length;

    this.sendActivity(aHttpActivity);
  },

  /**
   * Handler for ACTIVITY_SUBTYPE_RESPONSE_HEADER. This method stores
   * information about the response headers.
   *
   * @private
   * @param object aHttpActivity
   *        The HTTP activity object we are working with.
   * @param string aExtraStringData
   *        The uncached response headers.
   */
  _onResponseHeader:
  function NP__onResponseHeader(aHttpActivity, aExtraStringData)
  {
    // aExtraStringData contains the uncached response headers. The first line
    // contains the response status (e.g. HTTP/1.1 200 OK).
    //
    // Note: The response header is not saved here. Calling the
    // channel.visitResponseHeaders() methood at this point sometimes causes an
    // NS_ERROR_NOT_AVAILABLE exception.
    //
    // We could parse aExtraStringData to get the headers and their values, but
    // that is not trivial to do in an accurate manner. Hence, we save the
    // response headers in this.httpResponseExaminer().

    if (this.listeningWindows.indexOf(aHttpActivity.contentWindow) == -1) {
      return;
    }

    let response = aHttpActivity.log.entries[0].response;

    let headers = aExtraStringData.split(/\r\n|\n|\r/);
    let statusLine = headers.shift();

    let statusLineArray = statusLine.split(" ");
    response.httpVersion = statusLineArray.shift();
    response.status = statusLineArray.shift();
    response.statusText = statusLineArray.join(" ");
    response.headersSize = aExtraStringData.length;

    this.sendActivity(aHttpActivity);
  },

  /**
   * Handler for ACTIVITY_SUBTYPE_TRANSACTION_CLOSE. This method updates the HAR
   * timing information on the HTTP activity object and clears the request
   * from the list of known open requests.
   *
   * @private
   * @param object aHttpActivity
   *        The HTTP activity object we work with.
   */
  _onTransactionClose: function NP__onTransactionClose(aHttpActivity)
  {
    if (this.listeningWindows.indexOf(aHttpActivity.contentWindow) == -1) {
      return;
    }
    this._setupHarTimings(aHttpActivity);
    this.sendActivity(aHttpActivity);
    delete this.openRequests[aHttpActivity.id];
  },

  /**
   * Update the HTTP activity object to include timing information as in the HAR
   * spec. The HTTP activity object holds the raw timing information in
   * |timings| - these are timings stored for each activity notification. The
   * HAR timing information is constructed based on these lower level data.
   *
   * @param object aHttpActivity
   *        The HTTP activity object we are working with.
   */
  _setupHarTimings: function NP__setupHarTimings(aHttpActivity)
  {
    let timings = aHttpActivity.timings;
    let entry = aHttpActivity.log.entries[0];
    let harTimings = entry.timings;

    // Not clear how we can determine "blocked" time.
    harTimings.blocked = -1;

    // DNS timing information is available only in when the DNS record is not
    // cached.
    harTimings.dns = timings.STATUS_RESOLVING ?
                     timings.STATUS_RESOLVED.last -
                     timings.STATUS_RESOLVING.first : -1;

    if (timings.STATUS_CONNECTING_TO && timings.STATUS_CONNECTED_TO) {
      harTimings.connect = timings.STATUS_CONNECTED_TO.last -
                           timings.STATUS_CONNECTING_TO.first;
    }
    else if (timings.STATUS_SENDING_TO) {
      harTimings.connect = timings.STATUS_SENDING_TO.first -
                           timings.REQUEST_HEADER.first;
    }
    else {
      harTimings.connect = -1;
    }

    if ((timings.STATUS_WAITING_FOR || timings.STATUS_RECEIVING_FROM) &&
        (timings.STATUS_CONNECTED_TO || timings.STATUS_SENDING_TO)) {
      harTimings.send = (timings.STATUS_WAITING_FOR ||
                         timings.STATUS_RECEIVING_FROM).first -
                        (timings.STATUS_CONNECTED_TO ||
                         timings.STATUS_SENDING_TO).last;
    }
    else {
      harTimings.send = -1;
    }

    if (timings.RESPONSE_START) {
      harTimings.wait = timings.RESPONSE_START.first -
                        (timings.REQUEST_BODY_SENT ||
                         timings.STATUS_SENDING_TO).last;
    }
    else {
      harTimings.wait = -1;
    }

    if (timings.RESPONSE_START && timings.RESPONSE_COMPLETE) {
      harTimings.receive = timings.RESPONSE_COMPLETE.last -
                           timings.RESPONSE_START.first;
    }
    else {
      harTimings.receive = -1;
    }

    entry.time = 0;
    for (let timing in harTimings) {
      let time = Math.max(Math.round(harTimings[timing] / 1000), -1);
      harTimings[timing] = time;
      if (time > -1) {
        entry.time += time;
      }
    }
  },

  /**
   * Stops the Network Producer.
   */
  stopProducer: function NP_stopProducer()
  {
    Services.obs.removeObserver(this.httpResponseExaminer,
                                "http-on-examine-response");

    activityDistributor.removeObserver(this);

    if (this.progressListener) {
      let webProgress = docShell.QueryInterface(Ci.nsIWebProgress);
      webProgress.removeProgressListener(this.progressListener);
      delete this.progressListener;
    }

    delete this.openRequests;
    delete this.openResponses;
    delete this.listeningWindows;
  },
};

// Register this producer to Data Sink
DataSink.registerProducer(NetworkProducer, "NetworkProducer");
