var util = require("util");
var helpers = require('../reusables/helpers');
var promises = require("q");
var chunkingStreams = require('chunking-streams');
var SizeChunker = chunkingStreams.SizeChunker;

var ENDPOINTS = require("../enum/endpoints");

function StreamsExtendedStorage() {
    StreamsExtendedStorage.super_.apply(this, arguments);
    //already has a decorator
};


function storeFile(pathFromRoot, stream, mimeType /* optional */ , size /*optional, not so much*/ ) {
    var requestEngine = this.requestEngine;
    var decorate = this.getDecorator();
    return promises(true).then(function () {
        pathFromRoot = helpers.encodeNameSafe(pathFromRoot);
        var opts = {
            method: "POST",
            uri: requestEngine.getEndpoint() + ENDPOINTS.fscontent + encodeURI(pathFromRoot)
        }

        opts.headers = {};
        if (size >= 0) {
            opts.headers["Content-Length"] = size;
        }
        if (mimeType) {
            opts.headers["Content-Type"] = mimeType;
        }

        return requestEngine.promiseRequest(decorate(opts), function (req) {
                stream.pipe(req);
                //for compatibility with streams created with request
                //request returns a stream that is flowing, so we have to pause mannually and then it's hard to unpause at the right moment... so we're accepting a paused stream here too.
                try {
                    stream.resume();
                } catch (e) {};
            })
            .then(function (result) { //result.response result.body
                return ({
                    id: result.response.headers["etag"],
                    group_id: result.body.group_id,
                    path: pathFromRoot
                });
            });
    });
}

var uploadChunkSize = 10240; //10k chunks

function streamToChunks(pathFromRoot, stream, mimeType /* optional */ , sizeOverride /*optional*/ ) {
    var self = this;
    var defer = promises.defer();
    var chunker = new SizeChunker({
        chunkSize: sizeOverride || uploadChunkSize,
        flushTail: true
    });
    var chunkData;
    var chunkNumber = 0;
    var chunkedUploader;

    chunker.on('chunkStart', function (id, next) {
        chunkData = [];
        next();
    });

    chunker.on('chunkEnd', function (id, next) {
        var buf = Buffer.concat(chunkData);
        chunkNumber++;
        if (chunkNumber === 1) {
            if (stream._readableState.pipesCount === 0) {
                //only one chunk. lol, pass on to the normal upload
                StreamsExtendedStorage.super_.prototype.storeFile.call(self, pathFromRoot, buf, mimeType, buf.size)
                    .then(function (result) {
                        defer.resolve(result);
                    });
            } else {
                self.startChunkedUpload(pathFromRoot, buf, mimeType)
                    .then(function (chunked) {
                        chunkedUploader = chunked;
                        next();
                    }).fail(function (err) {
                        //no idea what now xD
                        defer.reject(err);
                    })
            }
        } else {
            if (stream._readableState.pipesCount === 0) {
                //last chunk
                return chunkedUploader.sendLastChunk(buf).then(function (result) {
                    defer.resolve(result);
                })
            } else {
                chunkedUploader.sendChunk(buf, chunkNumber)
                    .fail(function (err) {
                        //chunk failed. retry?
                        defer.reject(err);
                    })
                //accept another chunk async
                next();

            }
        }
    });

    chunker.on('data', function (chunk) {
        chunkData.push(chunk.data);
    });
    stream.pipe(chunker);
    return defer.promise;
}

function getFileStream(pathFromRoot, versionEntryId) {
    var requestEngine = this.requestEngine;
    var decorate = this.getDecorator();
    pathFromRoot = helpers.encodeNameSafe(pathFromRoot);
    var defer = promises.defer();

    var opts = {
        method: "GET",
        url: requestEngine.getEndpoint() + ENDPOINTS.fscontent + encodeURI(pathFromRoot),
        pool: {
            maxSockets: 50
        },
        headers: {
            'Connection': 'close'
        }
    }
    if (versionEntryId) {
        opts.params = opts.qs = { //xhr and request differ here
            "entry_id": versionEntryId
        };
    }

    function handleResponse(error, resp, body) {
        defer.resolve(resp);
    }

    function oneTry() {
        requestEngine.retrieveStreamFromRequest(decorate(opts))
            .then(function (requestObject) {
                requestObject.pause();
                requestObject.on('response', function (resp) {
                    requestEngine.retryHandler(handleResponse, function () {
                        setImmediate(oneTry);
                    })(null, resp, resp.body);
                });
            });
    }
    oneTry();

    return defer.promise;
}


module.exports = function (Storage) {

    util.inherits(StreamsExtendedStorage, Storage);

    StreamsExtendedStorage.prototype.getFileStream = getFileStream;
    StreamsExtendedStorage.prototype.storeFile = storeFile;
    StreamsExtendedStorage.prototype.streamToChunks = streamToChunks;


    return StreamsExtendedStorage;

};
