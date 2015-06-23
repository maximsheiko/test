if (Meteor.isClient) {
    Template.scanCreateForm.events({
        'submit #urlForm': function (event) {
            event.preventDefault();
            Meteor.call('getKeywords',$('#urlId').val(),function(err,result) {
                result.forEach(function(value){
                    var count =0;
                    Meteor.call('BingSearch',value,function(err,result){
                        result.data.d.results.forEach(function (value) {
                            //invoke method for each founded links
                            count++;
                            console.log(count);
                            Meteor.call('commentSearch', value.Url,function(err,result) {
                                console.log(result);
                            });
                        });
                    });
                });
            });
        }
    });
}

if (Meteor.isServer) {
    var fetchh = Meteor.npmRequire("fetch");

//проверка загружаемой страницы
//todo: refactor
    var checkUrl = function (url) {
        var excludes = ['.pdf', '.doc', '.docx', 'cutestat', 'clearwebstats', 'start.cv.ua'];
        var result;
        excludes.forEach(function (value) {
            if (url.indexOf(value) !== -1) {
                result = 1;
            }
        });
        return result;

    };
    Meteor.methods({
        /**
         * Получение ключевых слов с помощью Alchemy api
         * @param urlName
         * @returns {string}
         */
        getKeywords: function (urlName) {
            this.unblock();
            var url = "http://access.alchemyapi.com/calls/url/URLGetRankedKeywords?outputMode=json&url="
                + urlName + "&apikey=" + "e759fc508051f98c6f47a12934a547fdca8f3394";
            //synchronous GET
            var result = Meteor.http.get(url, {timeout: 5000});
            if (result.data.status === 'ERROR') {
                return result.data;
            } else {
                var keywords = _.pluck(result.data.keywords, 'text');
                keywords.forEach(function (value, index, arr) {
                    if (value.length < 4) {
                        arr.splice(index, 1);
                    }
                });
                return keywords;
            }
        },
        /**
         * вызов bing search
         * @param query
         * @param country
         * @returns {*}
         * @constructor
         */
        BingSearch: function (query) {
            this.unblock();
            var myQuery = "'" + query + "'";
            var bingAPIURL = "https://api.datamarket.azure.com/Bing/Search/Web?$format=json&Query=" + myQuery;
            return Meteor.http.call("POST", bingAPIURL, {
                auth: "user:" +
                "9FMpk0oQBIKTPlfXy2CcZ1i3f61eYeF9wHIBFCAcXfg", timeout: 10000
            });
        },

        /**
         * Проверка ссылки на наличие коментариев
         * @param url
         * @returns {*}
         */
        commentSearch: function (url) {
            this.unblock();
            var socialComments = {
                'vk': 'VK.Widgets.Comments',
                'facebook square': 'class="fb-comments"',
                'facebook': 'fb:comments',
                'disqus': 'id="disqus_thread',
                'decoment': 'class="decomments-comment-section"',
                'cackle': 'id="mc-container"'
            };

            if (!checkUrl(url)) {
                var result = Async.runSync(function (callback) {
                    fetchh.fetchUrl(url, {
                        headers: {'User-Agent': 'Mozilla/4.0 (compatible; MSIE 6.0; Windows NT 5.1; SV1; .NET CLR 1.0.3705;)'},
                        timeout: 5000
                    }, function (error, meta, body) {
                        var typeSocial = [];
                        if (body) {
                            _.each(socialComments, function (num, key) {
                                if (body.toString().indexOf(num) !== -1) {
                                    if (key === 'facebook') {
                                        key = 'facebook square';
                                    }
                                    if (typeSocial.indexOf(key) === -1) {
                                        typeSocial.push(key);
                                    }
                                    if (body.toString().indexOf('X-Frame-Options') !== -1) {
                                        typeSocial.push('x-frame');
                                    }
                                }
                            });
                            var $ = cheerio.load(body.toString());
                            var title = $('title').text();
                            callback(error, [typeSocial, title]);
                        } else {
                            callback(error);
                        }
                    });
                });
                console.log(result);
                if (!result.error) {
                    if (result.result[0].length) {
                        return result.result;
                    } else {
                        return false;
                    }
                } else {
                    throw new Meteor.Error("Response issue: ", result.error);
                }
            }
        },
        //todo: refactor govnokod
        /**
         * Функция поиска подходящих ссылок по ключевым словам
         * @param keywords
         * @param scanId
         * @param country
         * @param se
         */
        analysis: function (keywords, scanId, country, se) {
            this.unblock();
            var count = 0;
            var totalLink = 0;
            if (Meteor.userId() && Meteor.settings.public) {
                analyticEvents.createScan({
                    userId: Meteor.userId(),
                    scanId: scanId,
                    keywords: keywords,
                    se: se,
                    country: country
                });
            }
            Scan.update(scanId, {$set: {count: 0}});
            keywords.forEach(function (value, index, ar) {
                var keyword = ar[index];
                //invoke search engine for each keyword
                if (_.indexOf(se, 'bing') !== -1) {
                    Meteor.call('BingSearch', ar[index], country, function (err, result) {
                        if (err) {
                            throw new Meteor.Error("Can not call invoke bing search", err);
                        } else {
                            totalLink += result.data.d.results.length;
                            result.data.d.results.forEach(function (value, index, arr) {
                                //invoke method for each founded links
                                Meteor.call('commentSearch', arr[index].Url, function (err, result) {
                                    count++;
                                    Scan.update(scanId, {$inc: {count: 1}});
                                    if (result !== undefined && result[0]) {
                                        var xFrame;
                                        if (_.contains(result[0], 'x-frame')) {
                                            xFrame = true;
                                            result[0].splice(result[0].indexOf('x-frame'), 1);
                                        }
                                        //Add link into collection
                                        if (!Link.findOne({
                                                "keyword": keyword,
                                                "pageUrl": arr[index].Url,
                                                scanId: scanId
                                            })) {
                                            Link.insert({
                                                keyword: keyword,
                                                searchEngine: "bing",
                                                position: index + 1,
                                                page: result[1],
                                                pageUrl: arr[index].Url,
                                                type: result[0],
                                                scanId: scanId,
                                                status: 'New',
                                                xframe: xFrame,
                                                createdAt: moment(Date.now()).format("YYYY-MM-DDTHH:mm:ssZ")
                                            });
                                            Scan.update(scanId, {$inc: {links: 1, newLinks: 1}});
                                        } else {
                                            if (Link.findOne({
                                                    "keyword": keyword,
                                                    "pageUrl": arr[index].Url,
                                                    scanId: scanId
                                                }).position !== index + 1) {
                                                Link.update(Link.findOne({
                                                        "keyword": keyword,
                                                        "pageUrl": arr[index].Url,
                                                        scanId: scanId
                                                    })._id,
                                                    {$set: {position: index + 1}});
                                            }
                                        }
                                    }
                                    // check the end of scan
                                    if (count === totalLink && keyword === keywords[keywords.length - 1] && se.length !== 2) {
                                        Scan.update(scanId, {
                                            $set: {
                                                status: "done",
                                                modifiedAt: moment(Date.now()).format("YYYY-MM-DDTHH:mm:ssZ")
                                            }
                                        });
                                    }
                                });
                            });
                        }
                    });
                }
                if (_.indexOf(se, 'google') !== -1) {
                    Meteor.call('GoogleSearch', ar[index], country, function (err, result) {
                        if (err) {
                            throw new Meteor.Error("Can not call invoke google search");
                        } else {
                            totalLink += result.length;
                            result.forEach(function (value, index, arr) {
                                Meteor.call('commentSearch', arr[index].link, function (err, result) {
                                    count++;
                                    Scan.update(scanId, {$inc: {count: 1}});
                                    if (result !== undefined && result[0]) {
                                        var xframe;
                                        if (_.contains(result[0], 'x-frame')) {
                                            xframe = true;
                                            result[0].splice(result[0].indexOf('x-frame'), 1);
                                        }
                                        //Add link into collection
                                        if (!Link.findOne({
                                                "keyword": keyword,
                                                "pageUrl": arr[index].link,
                                                scanId: scanId
                                            })) {
                                            Link.insert({
                                                keyword: keyword,
                                                searchEngine: "google",
                                                position: index + 1,
                                                page: result[1],
                                                pageUrl: arr[index].link,
                                                type: result[0],
                                                scanId: scanId,
                                                status: 'New',
                                                xframe: xframe,
                                                createdAt: moment(Date.now()).format("YYYY-MM-DDTHH:mm:ssZ")
                                            });
                                            Scan.update(scanId, {$inc: {links: 1, newLinks: 1}});
                                        } else {
                                            if (Link.findOne({
                                                    "keyword": keyword,
                                                    "pageUrl": arr[index].link,
                                                    scanId: scanId
                                                }).position !== index + 1) {
                                                Link.update(Link.findOne({
                                                        "keyword": keyword,
                                                        "pageUrl": arr[index].link,
                                                        scanId: scanId
                                                    })._id,
                                                    {$set: {position: index + 1}});
                                            }
                                        }
                                    }
                                    // check the end of scan
                                    if (count === totalLink && keyword === keywords[keywords.length - 1]) {
                                        Scan.update(scanId, {
                                            $set: {
                                                status: "done",
                                                modifiedAt: moment(Date.now()).format("YYYY-MM-DDTHH:mm:ssZ")
                                            }
                                        });
                                    }
                                });
                            });
                        }
                    });
                }
            });
        },
    });


}
