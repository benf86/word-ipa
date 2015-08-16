'use strict';


//================== GENERAL IMPORTS
var express = require('express');
var app = express();
var fs = require('graceful-fs');
var assert = require('assert');
var Promise = require('promise');
var http = require('follow-redirects').http;

//================== DATABASE SETTINGS
var MongoClient = require('mongodb').MongoClient;
var mongoHost = 'localhost';
var mongoPort = 27017;
var mongoPath = '/data';
var mongoDatabase = null;
var mongoCollection = 'en_UK';

//================== PRE-LOADED FILE SETTINGS
var dictionary = {};
var sourcePath = process.argv[2];
var ignore = {};
var ignoredPath = process.argv[3];

//================== OXFORD DICTIONARY LOOKUP VARS
var lastODRequest = 0;
var numODRequests = 0;
var consecutiveODFails = 0;
var resolveAt = Date.now();

//================== ROUTING
app.get('/', function (req, res) {
    res.json({
        message: 'Welcome to the English ==> IPA transcriber API. To get a word transcribed, type a word after the address, e.g. /transcribeMe'
    });
})

app.get('/:word', function (req, res) {
    var out = {};
    out[req.params.word] = dictionary[req.params.word];
    res.json(out);
});

//================== RUNS EVERYTHING
loadDictionary()
    .then(
        function (db) {
            var server = app.listen(3000);
            mongoDatabase = db;
            if (sourcePath) {
                loadWords(sourcePath).then(
                    function (wordsArray) {
                        loadIgnored(ignoredPath).then(
                            function () {
                                wordsArray.forEach(
                                    function (word) {
                                        if (word === '') {
                                            //reject('Empty string');
                                            return;
                                        }
                                        else if (ignore[word]) {
                                            //reject('On ignore list')
                                            return;
                                        }
                                        if (dictionary[word]) {
                                            return;
                                        }
                                        transcribe(word).then(
                                            function (ipa) {
                                                if (ipa) {
                                                    console.log(word, ipa);
                                                    dictionary[word] = ipa;
                                                    persistToDictionary(db, {
                                                        word: word,
                                                        IPA: ipa
                                                    });
                                                }
                                            },
                                            function (err) {
                                                console.error(err);
                                                appendToNoHits(word);
                                                return;
                                            }
                                        )
                                    }
                                )
                            },
                            console.error
                        )
                    },
                    console.error
                )
            }
        },
        console.error
    ).catch(function (err) {
        console.error(err);
        return;
    })

//================== FUNCTIONS
/**
 * Loads the word:IPA database into memory
 */
function loadDictionary () {
    return new Promise(function (resolve, reject) {
        MongoClient.connect('mongodb://' + mongoHost + ':' + mongoPort + mongoPath, function (err, db) {
                if (err) reject(err);
                console.log('Connected to MongoDB');

                var stream = db.collection(mongoCollection).find({mykey:{$ne:2}}).stream();
                    stream.on("data", function (item) {
                        dictionary[item.word] = item.IPA;
                    });
                    stream.on("end", function () {
                        console.log('Current dictionary length: ' + Object.keys(dictionary).length + ' word:IPA pairs');
                        resolve(db);
                    });
            }
        );
    });
}

/**
 * Save a pair to the database
 * @param  {mongodb} db
 * @param  {object} wordIPAPair {word: word, IPA: transcription}
 */
function persistToDictionary (db, wordIPAPair) {
    return new Promise(function (resolve, reject) {
        var collection = db.collection(mongoCollection);
        collection.insert([wordIPAPair], function (err, result) {
            if (err) reject(err);
            resolve(result);
        });
    });
}

/**
 * Load the ignore list which shouldn't be looked up at OD
 * @param  {string} source Path to file with comma-delimited source words
 */
function loadIgnored (source) {
    return new Promise(function (resolve, reject) {
        fs.readFile(source, 'utf8', function (err, data) {
            if (err) {
                resolve();
                return;
            }
            data.split(',').map(function (e) {
                ignore[e] = true;
            });
            resolve();
        });
    });
}

/**
 * Load the initial source words to lookup and populate the DB with
 * @param  {string} source Path to file with \n delimited list of source words
 */
function loadWords (source) {
    return new Promise(function (resolve, reject) {
        console.log('Reading source file...');
        fs.readFile(source, 'utf8', function (err, data) {
            if (err) {
                reject(err);
                return;
            }
            console.log('Reading source file complete!');
            var returnArray = data.split('\n');
            resolve(returnArray);
        });
    });
}

/**
 * Get the IPA transcription of a word
 * @param  {string} word The word to transcribe to IPA
 */
function transcribe (word) {
    return new Promise(function (resolve, reject) {
        setTimeout(function () {
            getIPAFromOD(word).then(
                resolve, 
                function (err) {
                    reject(null)
                    return;
                }
            )
        }, resolveAt + 1000 - Date.now());
        resolveAt += 1000;
    });
}

var re = /Pronunciation: <\/a> \/(.*?)\//;
/**
 * Look up the word transcription at OD
 * @param  {string} word The word to look up
 */
function getIPAFromOD (word) {
    numODRequests++;
    return new Promise(function (resolve, reject) {
        console.log(word + ' =>> Making request #' + numODRequests + ' at ' + Date.now());
        http.request({
            'user-agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/28.0.1500.52 Safari/537.36',
            host: 'www.oxforddictionaries.com',
            path: 'http://oxforddictionaries.com/search/english/?direct=1&multi=1&q=' + word
        }, function (res) {
            var str = '';
            res.on('data', function (chunk) {
                str += chunk;
            });

            res.on('end', function () {
                var result = re.exec(str);
                if (!result) {
                    //fs.writeFile('misc/no/' + word, str, 'utf8');
                    reject(null);
                    return;
                }
                consecutiveODFails = 0;
                resolve(result[1]);
            });
        }).end();
    });
}

/**
 * Append the word to the ignore list
 * @param  {string} word The word to ignore in the future 
 */
function appendToNoHits (word) {
    console.log('No IPA found for ' + word);
    consecutiveODFails++;
    console.log('Consecutive fails: ' + consecutiveODFails);
    fs.appendFile(ignoredPath, ',' + word, console.error);
    if (consecutiveODFails >= 300) {
        console.error('Too many fails! Banned by OD?');
        process.exit();
    }
}