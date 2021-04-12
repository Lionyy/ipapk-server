#!/usr/bin/env node

var fs = require('fs-extra');
var https = require('https');
var path = require('path');
var exit = process.exit;
var pkg = require('./package.json');
var version = pkg.version;
var AdmZip = require("adm-zip");
var program = require('commander');
var express = require('express');
var mustache = require('mustache');
var strftime = require('strftime');
var underscore = require('underscore');
var os = require('os');
const formidable = require('formidable');
var sqlite3 = require('sqlite3');  
var uuidV4 = require('uuid/v4');
var extract = require('ipa-extract-info');
var nodeApk = require("node-apk");
require('shelljs/global');

/** 格式化输入字符串**/

//用法: "hello{0}".format('world')；返回'hello world'

String.prototype.format= function(){
  var args = arguments;
  return this.replace(/\{(\d+)\}/g,function(s,i){
    return args[i];
  });
}

before(program, 'outputHelp', function() {
  this.allowUnknownOption();
});

program
    .version(version)
    .usage('[option] [dir]')
    .option('-p, --port <port-number>', 'set port for server (defaults is 1234)')
    .option('-h, --host <host>', 'set host for server (defaults is your LAN ip)')
    .parse(process.argv);

var port = program.port || 1234;

var ipAddress = program.host || underscore
  .chain(require('os').networkInterfaces())
  .values()
  .flatten()
  .find(function(iface) {
    return iface.family === 'IPv4' && iface.internal === false;
  })
  .value()
  .address;

var pageCount = 5;
var serverDir = os.homedir() + "/.ipapk-server/"
var globalCerFolder = serverDir + ipAddress;
var ipasDir = serverDir + "ipa";
var apksDir = serverDir + "apk";
var iconsDir = serverDir + "icon";
createFolderIfNeeded(serverDir)
createFolderIfNeeded(ipasDir)
createFolderIfNeeded(apksDir)
createFolderIfNeeded(iconsDir)
function createFolderIfNeeded (path) {
  if (!fs.existsSync(path)) {  
    fs.mkdirSync(path, function (err) {
        if (err) {
            console.log(err);
            return;
        }
    });
  }
}

function excuteDB(cmd, params, callback) {
  var db = new sqlite3.Database(serverDir + 'db.sqlite3');
  db.run(cmd, params, callback);
  db.close();
}

function queryDB(cmd, params, callback) {
  var db = new sqlite3.Database(serverDir + 'db.sqlite3');
  db.all(cmd, params, callback);
  db.close();
}

excuteDB("CREATE TABLE IF NOT EXISTS info (\
  id integer PRIMARY KEY autoincrement,\
  guid TEXT,\
  bundleID TEXT,\
  version TEXT,\
  build TEXT,\
  name TEXT,\
  uploadTime datetime default (datetime('now', 'localtime')),\
  platform TEXT,\
  changelog TEXT\
  )");
/**
 * Main program.
 */
process.exit = exit

// CLI
var basePath = "https://{0}:{1}".format(ipAddress, port);
if (!exit.exited) {
  main();
}

/**
 * Install a before function; AOP.
 */


function isEmpty(value) {
  return (Array.isArray(value) && value.length === 0) || (Object.prototype.isPrototypeOf(value) && Object.keys(value).length === 0);
}

function before(obj, method, fn) {
  var old = obj[method];

  obj[method] = function() {
    fn.call(this);
    old.apply(this, arguments);
  };
}

function main() {

  console.log(basePath);

  var key;
  var cert;

  try {
    key = fs.readFileSync(globalCerFolder + '/mycert1.key', 'utf8');
    cert = fs.readFileSync(globalCerFolder + '/mycert1.cer', 'utf8');
  } catch (e) {
    var result = exec('sh  ' + path.join(__dirname, 'bin', 'generate-certificate.sh') + ' ' + ipAddress).output;
    key = fs.readFileSync(globalCerFolder + '/mycert1.key', 'utf8');
    cert = fs.readFileSync(globalCerFolder + '/mycert1.cer', 'utf8');
  }

  var options = {
    key: key,
    cert: cert
  };

  var app = express();
  app.use('/cer', express.static(globalCerFolder));
  app.use('/', express.static(path.join(__dirname,'web')));
  app.use('/ipa', express.static(ipasDir));
  app.use('/apk', express.static(apksDir));
  app.use('/icon', express.static(iconsDir));
  app.get(['/apps/:platform', '/apps/:platform/:page'], function(req, res, next) {
  	  res.set('Access-Control-Allow-Origin','*');
      res.set('Content-Type', 'application/json');
      var page = parseInt(req.params.page ? req.params.page : 1);
      if (req.params.platform === 'android' || req.params.platform === 'ios') {
        queryDB("select * from info where info.uploadTime in (select max(i.uploadTime) from info i where i.platform=? group by i.bundleID) order by uploadTime desc limit ?,?", [req.params.platform, (page - 1) * pageCount, page * pageCount], function(error, result) {
          if (result) {
            res.send(mapIconAndUrl(result))
          } else {
            errorHandler(error, res)
          }
        })
      }
  });

  app.get(['/apps/:platform/:bundleID', '/apps/:platform/:bundleID/:page'], function(req, res, next) {
  	  res.set('Access-Control-Allow-Origin','*');
      res.set('Content-Type', 'application/json');
      var page = parseInt(req.params.page ? req.params.page : 1);
      if (req.params.platform === 'android' || req.params.platform === 'ios') {
        queryDB("select * from info where platform=? and bundleID=? order by uploadTime desc limit ?,? ", [req.params.platform, req.params.bundleID, (page - 1) * pageCount, page * pageCount], function(error, result) {
          if (result) {
            res.send(mapIconAndUrl(result))
          } else {
            errorHandler(error, res)
          }
        })
      }
  });

  app.get('/plist/:guid', function(req, res) {
    queryDB("select name,bundleID from info where guid=?", [req.params.guid], function(error, result) {
      if (result) {
        fs.readFile(path.join(__dirname, 'templates') + '/template.plist', function(err, data) {
            if (err) throw err;
            var template = data.toString();
            var rendered = mustache.render(template, {
              guid: req.params.guid,
              name: result[0].name,
              bundleID: result[0].bundleID,
              basePath: basePath,
            });
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.set('Access-Control-Allow-Origin','*');
            res.send(rendered);
        })
      } else {
        errorHandler(error, res)
      }
    })
  });

  app.get('/delete/:deadline', function(req, res) {
    console.log('deadline = ' + req.params.deadline)
    queryDB("select name,platform,guid,bundleID from info where uploadTime BETWEEN '1970-01-01 00:00::00' AND ?", [req.params.deadline], function(error, result) {
      if (result) {
        if (!isEmpty(result)) {
          console.log('result len ', result.length)
          result.forEach(function(info) {
            deleteInfo(info, res)
          })
          var template = "删除成功！";
          res.set('Content-Type', 'text/plain; charset=utf-8')
          res.set('Access-Control-Allow-Origin','*');
          res.send(template);
        } else {
            var template = "未查询到旧记录数据，无需删除！";
            res.set('Content-Type', 'text/plain; charset=utf-8');
            res.set('Access-Control-Allow-Origin','*');
            res.send(template);
        }
      } else {
        errorHandler(error, res)
      }
    })

  });

  app.post('/upload', function(req, res) {
    const form = formidable({ multiples: true });
    form.parse(req, function(err, fields, files) {
      if (err) {
        errorHandler(err, res);
        return;
      }
      var changelog = fields.changelog
      console.log('changelog: ' + changelog)

      if (!files.package) {
        errorHandler("params error",res)
        return
      }

      var package = files.package
      var tmp_path = package.path
      var fileName = package.name

      parseAppAndInsertToDb(tmp_path, fileName, changelog, info => {
        storeApp(tmp_path, fileName, info["guid"], error => {
          if (error) {
            errorHandler(error,res)
          }
          console.log(info)
          res.send(info)
        })

      }, error => {
        errorHandler(error,res)
      });
    });
  });

  https.createServer(options, app).listen(port);
}

function errorHandler(error, res) {
  console.log(error)
  res.send({"error":error})
}

function mapIconAndUrl(result) {
  var items = result.map(function(item) {
    item.icon = "{0}/icon/{1}.png".format(basePath, item.guid);
    if (item.platform === 'ios') {
      item.url = "itms-services://?action=download-manifest&url={0}/plist/{1}".format(basePath, item.guid);
    } else if (item.platform === 'android') {
      item.url = "{0}/apk/{1}.apk".format(basePath, item.guid);
    }
    return item;
  })
  return items;
}

function deleteInfo(info, res) {
  // console.log('delete info ' + info)
  // console.log('info.name ' + info.name)
  if (!info) {
      console.log('DB 查询 info 为空')
      return
  }
  excuteDB("delete from info where guid=?;", [info.guid],function(error){
    if (!error){
      console.log('info.platform ' + info.platform)
      var pgFilePath
      var pgIconPath = path.join(iconsDir, info.guid + ".png")
      if (info.platform === 'android') {
        pgFilePath = path.join(apksDir, info.guid + ".apk")
      } else if (info.platform === 'ios') {
        pgFilePath = path.join(ipasDir, info.guid + ".ipa")
      }
      console.log('delete file -> ' + pgFilePath)
      fs.remove(pgIconPath, function(err){ 
        if(!err){ 
          console.log('删除成功: ' + pgIconPath)
        }
      })
      console.log('delete file -> ' + pgFilePath)
      fs.remove(pgFilePath, function(err){  
        if(!err){ 
          console.log('删除成功: ' + pgFilePath)
        } else {
          console.log('删除失败: ' + err)
        }
      })
    } else {
      console.log('删除数据库失败: ' + error)
    }
  });
}

function parseAppAndInsertToDb(filePath, fileName, changelog, callback, errorCallback) {
  var guid = uuidV4();
  var parse, extract
  if (path.extname(fileName) === ".ipa") {
    parse = parseIpa
    extract = extractIpaIcon
  } else if (path.extname(fileName) === ".apk") {
    parse = parseApk
    extract = extractApkIcon
  } else {
    errorCallback("params error")
    return;
  }
  Promise.all([parse(filePath),extract(filePath,guid)]).then(values => {
    var info = values[0]
    info["guid"] = guid
    info["changelog"] = changelog
    excuteDB("INSERT INTO info (guid, platform, build, bundleID, version, name, changelog) VALUES (?, ?, ?, ?, ?, ?, ?);",
    [info["guid"], info["platform"], info["build"], info["bundleID"], info["version"], info["name"], changelog],function(error){
        if (!error){
          callback(info)
        } else {
          errorCallback(error)
        }
    });
  }, reason => {
    errorCallback(reason)
  })
}

function storeApp(filePath, fileName, guid, callback) {
  var new_path;
  if (path.extname(fileName) === ".ipa") {
    new_path = path.join(ipasDir, guid + ".ipa");
  } else if (path.extname(fileName) === ".apk") {
    new_path = path.join(apksDir, guid + ".apk");
  }
  fs.rename(filePath,new_path,callback)
}

function parseIpa(filename) {
  return new Promise(function(resolve,reject){
    var fd = fs.openSync(filename, 'r');
    extract(fd, function(err, info, raw){
    if (err) reject(err);
      var data = info[0];
      var info = {}
      info["platform"] = "ios"
      info["build"] = data.CFBundleVersion,
      info["bundleID"] = data.CFBundleIdentifier,
      info["version"] = data.CFBundleShortVersionString,
      info["name"] = data.CFBundleDisplayName
      resolve(info)
    });
  });
}

function parseApk(filename) {
  return new Promise(function(resolve,reject){
    console.log('file path -> ', filename)
    let apk = new nodeApk.Apk(filename)
    Promise.all([apk.getManifestInfo(), apk.getResources()]).then((values) => {
      manifest = values[0]
      resources = values[1]
      // console.log(JSON.stringify(manifest.raw, null, 4));
      // console.log("resources : ", resources)
      let label = manifest.applicationLabel;
      if (typeof label !== "string") {
        const all = resources.resolve(label);
        label = (all.find((res) => (res.locale && res.locale.language === "fr")) || all[0]).value;
      }
      var info = {
        "name":label,
        "build":manifest.versionCode,
        "bundleID":manifest.package,
        "version":manifest.versionName,
        "platform":"android"
      }
      resolve(info)
      apk.close();
    });
  });
}

function parseText(text) {
  var regx = /(\w+)='([\w\.\d]+)'/g
  var match = null, result = {}
  while(match = regx.exec(text)) {
    result[match[1]] = match[2]
  }
  return result
}

function extractApkIcon(filename,guid) {
  return new Promise(function(resolve, reject){    
    var apk = new nodeApk.Apk(filename)
    Promise.all([apk.getManifestInfo(), apk.getResources()]).then((values) => {
      manifest = values[0]
      resources = values[1]
      let applicationIcon = manifest.applicationIcon;
      if (typeof applicationIcon !== "string") {
        const all = resources.resolve(applicationIcon);
        applicationIcon = (all.find((res) => (res.locale && res.locale.language === "fr")) || all[0]).value;
        // console.log('resources applicationIcon = ' + applicationIcon)
      }
      // resolve and extract the first application icon found
      return apk.extract(applicationIcon);

    }).then((buffer) => {
      if (buffer.length) {
          let tmpOut = iconsDir + "/{0}.png".format(guid)
          fs.writeFile(tmpOut, buffer, function(err){  
            if(err){ 
                reject(err)
            }
            resolve({"success":true})
          })
      } else {
        reject("can not find icon")
      }
      apk.close();
    })
  })
}

function extractIpaIcon(filename,guid) {
  return new Promise(function(resolve,reject){
    var tmpOut = iconsDir + "/{0}.png".format(guid)
    var zip = new AdmZip(filename); 
    var ipaEntries = zip.getEntries();
    var found = false;
    ipaEntries.forEach(function(ipaEntry) {
      if (ipaEntry.entryName.indexOf('AppIcon60x60@2x.png') != -1) {
        found = true;
        var buffer = new Buffer(ipaEntry.getData());
        if (buffer.length) {
          fs.writeFile(tmpOut, buffer,function(err){  
            if(err){  
              reject(err)
            } else {
              var execResult = exec(path.join(__dirname, 'bin','pngdefry -s _tmp ') + ' ' + tmpOut)
              if (execResult.stdout.indexOf('not an -iphone crushed PNG file') != -1) {
                resolve({"success":true})
              } else {
                fs.remove(tmpOut,function(err){  
                  if(err){
                    reject(err)
                  } else {
                    var tmp_path = iconsDir + "/{0}_tmp.png".format(guid)
                    fs.rename(tmp_path,tmpOut,function(err){
                      if(err){
                        reject(err)
                      } else {
                        resolve({"success":true})
                      }
                    })
                  }
                })
              }
            }
          })
        }
      }
    })
    if (!found) {
      reject("can not find icon ")
    }
  })
}
