/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this file,
 * You can obtain one at http://mozilla.org/MPL/2.0/. */

let {classes: Cc, interfaces: Ci, utils: Cu} = Components;

Cu.import("resource://gre/modules/XPCOMUtils.jsm");
Cu.import("resource://gre/modules/Services.jsm");
Cu.import("resource:///modules/NetworkHelper.jsm");

var EXPORTED_SYMBOLS = ["NetworkProducer"];

XPCOMUtils.defineLazyServiceGetter(this, "activityDistributor",
                                   "@mozilla.org/network/http-activity-distributor;1",
                                   "nsIHttpActivityDistributor");

XPCOMUtils.defineLazyServiceGetter(this, "mimeService",
                                   "@mozilla.org/mime;1",
                                   "nsIMIMEService");

XPCOMUtils.defineLazyGetter(this, "NetUtil", function () {
  var obj = {};
  Cu.import("resource://gre/modules/NetUtil.jsm", obj);
  return obj.NetUtil;
});

// The lowest HTTP response code (inclusive) that is considered an error.
const MIN_HTTP_ERROR_CODE = 400;
// The highest HTTP response code (exclusive) that is considered an error.
const MAX_HTTP_ERROR_CODE = 600;

// HTTP status codes.
const HTTP_MOVED_PERMANENTLY = 301;
const HTTP_FOUND = 302;
const HTTP_SEE_OTHER = 303;
const HTTP_TEMPORARY_REDIRECT = 307;

// The maximum uint32 value.
const PR_UINT32_MAX = 4294967295;

// The pref prefix for network producer filters
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
 * A WebProgressListener that listens for location changes. This progress
 * listener is used to track file loads. When a file:// URI is loaded
 * a "WebConsole:FileActivity" message is sent to the remote Web Console
 * instance. The message JSON holds only one property: uri (the file URI).
 *
 * @constructor
 */
function ConsoleProgressListener() { }

ConsoleProgressListener.prototype = {
  QueryInterface: XPCOMUtils.generateQI([Ci.nsIWebProgressListener,
                                         Ci.nsISupportsWeakReference]),

  onStateChange: function CPL_onStateChange(aProgress, aRequest, aState,
                                            aStatus)
  {
    if (!(aState & Ci.nsIWebProgressListener.STATE_START)) {
      return;
    }

    let uri = null;
    if (aRequest instanceof Ci.imgIRequest) {
      let imgIRequest = aRequest.QueryInterface(Ci.imgIRequest);
      uri = imgIRequest.URI;
    }
    else if (aRequest instanceof Ci.nsIChannel) {
      let nsIChannel = aRequest.QueryInterface(Ci.nsIChannel);
      uri = nsIChannel.URI;
    }

    if (!uri || !uri.schemeIs("file") && !uri.schemeIs("ftp")) {
      return;
    }

    NetworkProducer.sendMessage("Producers:FileActivityProducer", {uri: uri.spec});
  },

  onLocationChange: function() {},
  onStatusChange: function() {},
  onProgressChange: function() {},
  onSecurityChange: function() {},
};

// The Network Producer //

/**
 * The network producer uses the nsIHttpActivityDistributor to monitor network
 * requests. The nsIObserverService is also used for monitoring
 * http-on-examine-response notifications. All network request information is
 * routed to the remote Web Console.
 */
let NetworkProducer = {
  httpTransactionCodes: {
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
  },

  harCreator: {
    name: Services.appinfo.name + " - Graphical Timeline",
    version: Services.appinfo.version,
  },

  // Network response bodies are piped through a buffer of the given size (in
  // bytes).
  responsePipeSegmentSize: null,

  openRequests: null,
  openResponses: null,
  progressListener: null,

  /**
   * Getter for a unique ID for the Network Producer.
   */
  get sequenceId() "NetworkProducer-" + (++this._sequence),

  /**
   * Method derived from the producer Manager at the initialization of
   * Network Producer via init method.
   */
  sendMessage: function {},

  /**
   * The network producer initializer.
   *
   * @param function aSendMessage
   *        The method to send the HAR object to remote graph/data sink
   *        asynchronously. This argument cannot be null as it is used by
   *        the Producer to send the captured events.
   * @param object aMessage
   *        Initialization object sent by the Data Sink instance. This object
   *        can hold one property: monitorFileActivity - a boolean that tells if
   *        monitoring of file:// requests should be enabled as well or not.
   */
  init: function NP_init(aSendMessage, aMessage)
  {
    if (aSendMessage == null || typeof aSendMessage != "function") {
      return;
    }

    this.sendMessage = aSendMessage;

    this.responsePipeSegmentSize = Services.prefs
                                   .getIntPref("network.buffer.cache.size");

    this.openRequests = {};
    this.openResponses = {};

    activityDistributor.addObserver(this);

    Services.obs.addObserver(this.httpResponseExaminer,
                             "http-on-examine-response", false);

    /* // Monitor file:// activity as well.
    if (aMessage && aMessage.monitorFileActivity) {
      let webProgress = docShell.QueryInterface(Ci.nsIWebProgress);
      this.progressListener = new ConsoleProgressListener();
      webProgress.addProgressListener(this.progressListener,
        Ci.nsIWebProgress.NOTIFY_STATE_ALL);
    } */
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
    if (!win) {
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
   * Send an HTTP activity object to the graph/data sink using the sendMessage
   * function assigned to this producer via the producer manager.
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

    this.sendMessage("Producers:NetworkProducer", {
      tabId: tabId,
      meta: aHttpActivity.meta,
      log: aHttpActivity.log,
    });
  },

  /**
   * Handler for ACTIVITY_SUBTYPE_REQUEST_BODY_SENT. The request body is logged
   * here.
   *
   * @private
   * @param object aHttpActivity
   * The HTTP activity object we are working with.
   */
  _onRequestBodySent: function NM__onRequestBodySent(aHttpActivity)
  {
    if (aHttpActivity.meta.discardRequestBody) {
      return;
    }

    let request = aHttpActivity.log.entries[0].request;

    let sentBody = NetworkHelper.
    readPostTextFromRequest(aHttpActivity.channel,
    aHttpActivity.charset);

    if (!sentBody && request.url == Manager.window.location.href) {
      // If the request URL is the same as the current page URL, then
      // we can try to get the posted text from the page directly.
      // This check is necessary as otherwise the
      // NetworkHelper.readPostTextFromPage()
      // function is called for image requests as well but these
      // are not web pages and as such don't store the posted text
      // in the cache of the webpage.
      sentBody = NetworkHelper.readPostTextFromPage(docShell,
                                                    aHttpActivity.charset);
    }
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
  destroy: function NP_destroy()
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
  },
};
