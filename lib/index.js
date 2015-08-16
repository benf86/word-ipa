'use strict';

var express = require('express');
var app = express();
var fs = require('graceful-fs');
var assert = require('assert');
var Promise = require('promise');
var http = require('follow-redirects').http;


var MongoClient = require('mongodb').MongoClient;
var mongoHost = 'localhost';
var mongoPort = 3003;
var mongoPath = '/data';
var mongoDatabase = null;
var mongoCollection = 'en_UK';

var dictionary = { 
    epic: '\ˈɛpɪk',
    sexy: '\ˈsɛksi'
};

var ignore = {}

'oxford,epinions,psp,ds,stocks,ea,lg,nw,ff,misc,holdem,ps,const,ky,br,wikipedia,ml,employed,voip,ut,sexcam,css,milfhunter,toshiba,qty,uniprotkb,beastiality,birmingham,committees,upskirt,pcs,blowjobs,vi,aged,pmid,cr,medline,susan,ks,adams,sw,hd,livecam,nintendo,gcc,cumshot,nv,su,debian,epson,jon,nr,lbs,waters,toyota,larry,nl,postposted,steven,tr,cialis,bb,nz,okay,desired,firefox,vbulletin,citysearch,kings,nsw,pci,guestbook,bmw,rico,phil,twiki,dicke,rm,api,config,cf,vt,urw,wishlist,philips,foto,gm,ri,rt,cp,nikon,exposed,dd,aud,pl,crm,rf,cumshots,td,sb,sm,usc,trembl,blvd,amd,wv,ns,hrs,chevrolet,compaq,showtimes,img,deutsch,nutten,mhz,winds,ll,cl,ieee,parker,corp,gt,ae,nyc,hs,basics,struct,ot,yr,eminem,assumed,ic,dealtime,mercedes,zus,tramadol,mx,gr,xhtml,ext,framed,michelle,ts,ncaa,ng,pe,pentium,goto,netscape,tcp,dv,dir,val,flickr,fotos,britney,katrina,tu,fy,ghz,gamecube,rr,titten,ep,gbp,slideshow,lb,jelsoft,af,sl,seo,nissan,hb,jpg,norton,tc,ssl,gangbang,mlb,oem,ir,lycos,zdnet,ecommerce,mitsubishi,mozilla,oclc,holdings,espn,nhl,doug,gs,bbw,ni,thats,asin,expansys,kodak,fs,approx,nn,kde,signup,vb,separated,proc,dl,alt,ls,phpbb,packed,upskirts,lt,eq,cms,sg,vic,pos,utils,phys,nav,verizon,lc,lil,das,sys,solaris,scales,icq,yamaha,cu,dns,pty,bizrate,stockings,gamespot,wordpress,accredited,univ,np,tft,jvc,katie,spirits,por,mem,gc,ci,macromedia,yn,mastercard,kijiji,bases,cfr,starsmerchant,pmc,myspace,nb,levitra,ddr,ampland,pb,chem,shopzilla,oe,jd,gpl,wy,dm,mls,transexuales,audi,ppc,drops,jc,freebsd,prostores,dist,xnxx,childrens,thumbzilla,avi,pichunter,pins,bdsm,rpg,pd,adidas,tgp,livesex,arg,worldsex,ati,wal,mcdonald,ln,uc,zope,gmbh,buf,ld,webshots,msgid,suse,mf,amongst,msgstr,mw,adipex,dp,ht,za,ve,amanda,kelkoo,bacteria,pts,rh,fg,symantec,ooo,hz,humanities,epinions,psp,ds,stocks,de,program,hours,la,things,latest,ca,nov,al,de,program,hours,la,things,latest,ca,nov,al,committee,rss,co,feb,sep,microsoft,st,aug,rules,lyrics,words,de,program,hours,la,things,latest,ca,nov,al,committee,rss,co,feb,sep,microsoft,st,aug,rules,lyrics,words,jul,taken,sony,supplies,lines,needed,ny,eur,Sun,usr,dc,com,homepage,fri,cnet,los,communications,tue,wanted,paypal,thu,nokia,tx,ie,iii,fl,prev,il,int,goods,ed,php,msn,le,az,mi,th,dr,angeles,kb,vol,selling,xbox,fi,nc,llc,hardcore,va,rd,kb,vol,selling,xbox,fi,nc,llc,hardcore,va,rd,sc,se,km,samsung,thoughts,ft,cds,im,ar,motorola,sa,xp,sitemap,cvs,des,cm,wi,ct,named,nj,hr,rw,prepared,disk,pubmed,du,ups,tripadvisor,es,gb,fr,var,protected,shemale,bags,removed,usd,utilities,healthcare,ch,sd,devel,rs,shares,avg,panasonic,src,zum,tim,sql,pieces,sexo,nm,mn,nd,acc,greatest,continuing,tn,elizabeth,playstation,aol,utc,der,verzeichnis,circumstances,sp,nh,mysql,fm,blowjob,indicated,weapons,db,ia,ipaq,bk,ste,dx,sk,biol,yu,sq,oc,fujitsu,treo,une,tex,sublimedirectory,ears,wp,tp,gis,itunes,cn,proceeding,volkswagen'.split(',').map(function (e) {
    ignore[e] = true;
})

var lastODRequest = 0;
var numODRequests = 0;
var consecutiveODFails = 0;
var resolveAt = Date.now();

loadDictionaryAsPromise()
    .then(
        function (db) {
            var server = app.listen(3000);
            mongoDatabase = db;

            loadWords().then(
                function (wordsArray) {
                    var out = wordsArray.forEach(
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
                            translate(word).then(
                                function (ipa) {
                                    if (ipa) {
                                        console.log(word, ipa);
                                        dictionary[word] = ipa;
                                        persistToDictionaryAsPromise(db, {
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
    ).catch(function (err) {
        console.error(err);
        return;
    })


app.get('/:word', function (req, res) {
    res.send(dictionary[req.params.word]);
});

function loadDictionaryAsPromise () {
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

function persistToDictionaryAsPromise (db, wordIPAPair) {
    return new Promise(function (resolve, reject) {
        var collection = db.collection(mongoCollection);
        collection.insert([wordIPAPair], function (err, result) {
            if (err) reject(err);
            resolve(result);
        });
    });
}

function loadWords () {
    return new Promise(function (resolve, reject) {
        console.log('Reading source file...');
        fs.readFile('misc/20k.txt', 'utf8', function (err, data) {
            if (err) reject(err);
            console.log('Reading source file complete!');
            var returnArray = data.split('\n');
            resolve(returnArray);
        });
    });
}

function translate (word) {
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
                    fs.writeFile('misc/no/' + word, str, 'utf8');
                    reject(null);
                    return;
                }
                consecutiveODFails = 0;
                resolve(result[1]);
            });
        }).end();
    });
}

function appendToNoHits (word) {
    console.log('No IPA found for ' + word);
    consecutiveODFails++;
    console.log('Consecutive fails: ' + consecutiveODFails);
    fs.appendFile('noHits.txt', ',' + word, console.error);
    if (consecutiveODFails >= 300) {
        console.error('Too many fails! Banned by OD?');
        process.exit();
    }
}