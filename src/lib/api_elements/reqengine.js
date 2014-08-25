var quotaRegex = /^<h1>Developer Over Qps/i;


var promises = require("q");
var helpers = require('../reusables/helpers');
var dom = require('../reusables/dom');
var messages = require('../reusables/messages');
var errorify = require("./errorify");
var request = require("request");



function Engine(auth, options) {
    this.auth = auth;
    this.options = options;

    this.requestHandler = (options.httpRequest) ? options.httpRequest : request;

    this.quota = {
        startOfTheSecond: 0,
        calls: 0,
        retrying: 0
    }
    this.queue = [];

    this.queueHandler = helpers.bindThis(this, _rollQueue);

    auth.addRequestEngine(this);

}

var enginePrototypeMethods = {};



//======================================================================
//request handling
function params(obj) {
    var str = [];
    //cachebuster for IE
//    if (typeof window !== "undefined" && window.XDomainRequest) {
//        str.push("random=" + (~~(Math.random() * 9999)));
//    }
    for (var p in obj) {
        if (obj.hasOwnProperty(p)) {
            str.push(encodeURIComponent(p) + "=" + encodeURIComponent(obj[p]));
        }
    }
    if (str.length) {
        return "?" + str.join("&");
    } else {
        return "";
    }
}

enginePrototypeMethods.getEndpoint = function () {
    return this.options.egnyteDomainURL + "/pubapi/v1";
}

enginePrototypeMethods.promise = function (value) {
    return promises(value);
}

enginePrototypeMethods.sendRequest = function (opts, callback) {
    var self = this;
    var originalOpts = helpers.extend({}, opts);
    if (this.auth.isAuthorized()) {
        opts.response = true; //xhr specific
        opts.url += params(opts.params);
        opts.headers = opts.headers || {};
        opts.headers["Authorization"] = "Bearer " + this.auth.getToken();
        if (!callback) {
            return self.requestHandler(opts);
        } else {
            return self.requestHandler(opts, function (error, response, body) {
                //emulating the default XHR behavior
                if (!error && response.statusCode >= 400 && response.statusCode < 600) {
                    error = new Error(body);
                }
                try {
                    //this shouldn't be required, but server sometimes responds with content-type text/plain
                    body = JSON.parse(body);
                } catch (e) {}
                var retryAfter, masheryCode;
                retryAfter = response.headers["retry-after"];
                masheryCode = response.headers["x-mashery-error-code"];
                //in case headers get returned as arrays, we only expect one value
                retryAfter = typeof retryAfter === "array" ? retryAfter[0] : retryAfter;
                masheryCode = typeof masheryCode === "array" ? masheryCode[0] : masheryCode;
                if (
                    self.options.handleQuota &&
                    response.statusCode === 403 &&
                    retryAfter
                ) {
                    if (masheryCode === "ERR_403_DEVELOPER_OVER_QPS") {
                        //retry
                        console && console.warn("developer over QPS, retrying");
                        self.quota.retrying = 1000 * ~~(retryAfter);
                        setTimeout(function () {
                            self.quota.retrying = 0;
                            self.sendRequest(originalOpts, callback);
                        }, self.quota.retrying);

                    }
                    if (masheryCode === "ERR_403_DEVELOPER_OVER_RATE") {
                        error.RATE = true;
                        callback.call(this, error, response, body);
                    }

                } else {

                    if (
                        //Checking for failed auth responses
                        //(ノಠ益ಠ)ノ彡┻━┻
                        self.options.onInvalidToken &&
                        (
                            response.statusCode === 401 ||
                            (
                                response.statusCode === 403 &&
                                masheryCode === "ERR_403_DEVELOPER_INACTIVE"
                            )
                        )
                    ) {
                        self.auth.dropToken();
                        self.options.onInvalidToken();
                    }

                    callback.call(this, error, response, body);
                }
            });
        }
    } else {
        callback.call(this, new Error("Not authorized"), {
            statusCode: 0
        }, null);
    }

}

enginePrototypeMethods.promiseRequest = function (opts, requestHandler) {
    var defer = promises.defer();
    var self = this;
    var requestFunction = function () {
        try {
            var req = self.sendRequest(opts, function (error, response, body) {
                if (error) {
                    defer.reject(errorify({
                        error: error,
                        response: response,
                        body: body
                    }));
                } else {
                    defer.resolve({
                        response: response,
                        body: body
                    });
                }
            });
            requestHandler && requestHandler(req);
        } catch (error) {
            defer.reject(errorify({
                error: error
            }));
        }
    }
    if (!this.options.handleQuota) {
        requestFunction();
    } else {
        //add to queue
        this.queue.push(requestFunction);
        //stop previous queue processing if any
        clearTimeout(this.quota.to);
        //start queue processing
        this.queueHandler();
    }
    return defer.promise;
}


//gets bound to this in the constructor and saved as this.queueHandler
function _rollQueue() {
    if (this.queue.length) {
        var currentWait = _quotaWaitTime(this.quota, this.options.QPS);
        if (currentWait === 0) {
            var requestFunction = this.queue.shift();
            requestFunction();
            this.quota.calls++;
        }
        this.quota.to = setTimeout(this.queueHandler, currentWait);
    }

}

function _quotaWaitTime(quota, QPS) {
    var now = +new Date();
    var diff = now - quota.startOfTheSecond;
    //in the middle of retrying a denied call
    if (quota.retrying) {
        quota.startOfTheSecond = now + quota.retrying;
        return quota.retrying + 1;
    }
    //last call was over a second ago, can start
    if (diff > 1000) {
        quota.startOfTheSecond = now;
        quota.calls = 0;
        return 0;
    }
    //calls limit not reached
    if (quota.calls < QPS) {
        return 0;
    }
    //calls limit reached, delay to the next second
    return 1001 - diff;
}


Engine.prototype = enginePrototypeMethods;

module.exports = Engine;