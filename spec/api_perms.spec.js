var ImInBrowser = (typeof window !== "undefined");

if (!ImInBrowser) {
    var stream = require('stream')
    var concat = require('concat-stream')
    Egnyte = require("../src/slim");
    require("./conf/apiaccess");
    require("./helpers/matchers");

    process.setMaxListeners(0);
}

describe("Permissions API facade integration", function () {

    //our main testsubject
    var eg = Egnyte.init(egnyteDomain, {
        token: APIToken,
        oldIEForwarder: true, //opt in for IE8/9 support
        QPS: 2
    });


    function getTestBlob(txt) {
        var content = '<a id="a"><b id="b">' + txt + '</b></a>'; // the body of the new file...
        if (ImInBrowser) {
            // JavaScript file-like object...
            //PhanthomJS has a broken Blob
            try {
                var blob = new Blob([content], {
                    type: "text/xml"
                });
            } catch (e) {
                //napaeeee!
                var blob = content;
            }
            return blob;
        } else {
            var s = new stream.Readable();
            s.push(content);
            s.push(null);
            return s;
        }
    }



    if (ImInBrowser) {
        if (!window.egnyteDomain || !window.APIToken) {
            throw new Error("spec/conf/apiaccess.js is missing");
        }
    } else {
        if (!egnyteDomain || !APIToken) {
            throw new Error("spec/conf/apiaccess.js is missing");
        }
    }

    beforeEach(function () {
        jasmine.getEnv().defaultTimeoutInterval = 20000; //QA API can be laggy
        jasmine.DEFAULT_TIMEOUT_INTERVAL = 20000; //QA API can be laggy
    });

    it('should accept an existing token', function () {
        //token was passed in beforeEach
        expect(eg.API.auth.isAuthorized()).toBe(true);
    });

    var testpath;

    describe("Permissions methods", function () {

        it("Needs a folder to set permissions to", function (done) {
            eg.API.storage.get("/Shared")
                .then(function (e) {
                    expect(e["folders"]).toBeDefined();
                    //this test suite has unicorns and bacon, it can't get any better/
                    testpath = e.folders[0].path + "/bacon" + ~~(10000 * Math.random());
                    return eg.API.storage.createFolder(testpath)
                })
                .then(function (e) {
                    done();
                }).fail(function (e) {
                    expect(this).toAutoFail(e);
                    done();
                });
        });


        it("Can set basic permissions", function (done) {
            //would be nice to create the user first...
            eg.API.perms.users(["test", "banana"]).allowEdit(testpath)
                .then(function (e) {
                    expect(e.statusCode).toEqual(200); //actually checking if it exists
                    return eg.API.perms.users(["test"]).getPerms(testpath);
                }).then(function (e) {
                    expect(e.users.length).toBeGreaterThan(0);
                    expect(e.users[0].subject).toBe("test");
                    done();
                }).fail(function (e) {
                    expect(this).toAutoFail(e);
                    done();
                });

        });

        it("Can filter permissions", function (done) {
            eg.API.perms.users(["JohnnyIHardlyKnewYa"]).getPerms(testpath)
                .then(function (e) {
                    expect(e.users.length).toEqual(0);
                    return eg.API.perms.getPerms(testpath);
                }).then(function (e) {
                    expect(e.users.length).toBeGreaterThan(0);
                    done();
                }).fail(function (e) {
                    expect(this).toAutoFail(e);
                    done();
                });

        });

        describe("Impersonated locking", function () {
            var token;

            it("Needs a file to lock", function (done) {
                var blob = getTestBlob("hey!");

                eg.API.storage.storeFile(testpath + "/aaa", blob)
                    .then(function (e) {
                        done();
                    }).fail(function (e) {
                        expect(this).toAutoFail(e);
                        done();
                    });

            });

            it("Can lock a file as other user", function (done) {
                eg.API.storage.impersonate({
                        username: "test"
                    }).lock(testpath + "/aaa", null, 1800)
                    .then(function (result) {
                        token = result.lock_token;
                        expect(result.lock_token).toBeTruthy();
                        expect(result.timeout).toBeTruthy();
                        done();
                    }).fail(function (e) {
                        expect(this).toAutoFail(e);
                        done();
                    });

            });

            it("Can unlock a file as other user", function (done) {
                eg.API.storage.impersonate({
                        username: "test"
                    }).unlock(testpath + "/aaa", token)
                    .then(function (result) {
                        //just getting here is ok.
                        expect(result).toBeDefined();
                        done();
                    }).fail(function (e) {
                        expect(this).toAutoFail(e);
                        done();
                    });

            });

        });

        it("Needs to clean up the folder", function (done) {
            eg.API.storage.remove(testpath)
                .then(function (e) {
                    expect(true).toBeTruthy();
                    done();
                }).fail(function (e) {
                    expect(this).toAutoFail(e);
                    done();
                });
        });

    });
});