var fs = require("fs");
var path = require('path');
var brocWriter = require("broccoli-writer");
var helpers = require("broccoli-kitchen-sink-helpers");
var funnel = require('broccoli-funnel');

var swToolboxFile = require.resolve('sw-toolbox/sw-toolbox.js');
var swToolboxMapFile = require.resolve('sw-toolbox/sw-toolbox.js.map');

var rsvp= require('rsvp');
var BroccoliServiceWorker = function BroccoliServiceWorker(inTree, options) {
  if (!(this instanceof BroccoliServiceWorker)) {
    return new BroccoliServiceWorker(inTree, options);
  }
  this.inTree = inTree;
  options = options || {};
  if (options.skipWaiting === false) {
    this.skipWaiting = false;
  } else {
    this.skipWaiting = true;
  }
  this.cachePrefix = options.cachePrefix || 'brocsw-v';
  this.cacheFirstURLs = options.cacheFirstURLs || [];
  this.cacheOnlyURLs = options.cacheOnlyURLs || [];
  this.fastestURLs = options.fastestURLs || [];
  this.debug = options.debug || false;
  this.sourcemaps = options.sourcemaps || this.debug;
  this.networkFirstURLs = options.networkFirstURLs || options.dynamicCache || [];
  this.excludePaths = options.excludePaths || ['tests/*'];
  this.fallback = options.fallback || [];
  this.rootURL = (options.rootURL === false ? false : options.rootURL || '/');
  this.precacheURLs = options.precacheURLs || [];
  if (options.includeRegistration === false) {
    this.includeRegistration = false;
  } else {
    this.includeRegistration = true;
  }
  if (this.includeRegistration === true || !options.serviceWorkerFile) {
    this.serviceWorkerFile = "service-worker.js";
  } else {
    this.serviceWorkerFile = options.serviceWorkerFile;
  }

  this.swPreIncludeTree = options.swPreIncludeTree;
  this.swMainIncludeTree = options.swIncludeTree;

  this.swPreIncludeFiles = options.swPreIncludeFiles;
  this.swMainIncludeFiles = options.swIncludeFiles;

  this.swEnvironment = options.swEnvironment || {};

  this.toolboxDestination = options.toolboxDestination || '';
};

BroccoliServiceWorker.prototype = Object.create(brocWriter.prototype);
BroccoliServiceWorker.prototype.constructor = BroccoliServiceWorker;

BroccoliServiceWorker.prototype.write = function(readTree, destDir) {
  var skipWaiting = this.skipWaiting;
  var cachePrefix = this.cachePrefix;
  var cacheFirstURLs = this.cacheFirstURLs;
  var cacheOnlyURLs = this.cacheOnlyURLs;
  var debug = this.debug;
  var sourcemaps = this.sourcemaps;
  var networkFirstURLs = this.networkFirstURLs;
  var fallback = this.fallback;
  var rootURL = this.rootURL;
  var fastestURLs = this.fastestURLs;
  var precacheURLs = this.precacheURLs;
  var serviceWorkerFile = this.serviceWorkerFile;
  var serviceWorkerTree = funnel(this.inTree, {
    exclude: this.excludePaths
  });

  var swPreIncludeFiles = this.swPreIncludeFiles;
  var swMainIncludeFiles = this.swMainIncludeFiles;

  var swPreIncludeTree = this.swPreIncludeTree;
  var swMainIncludeTree = this.swMainIncludeTree;

  var swEnvironment = this.swEnvironment;

  var toolboxDestination = this.toolboxDestination;

  var includePromises = {
    swPreIncludeDir: readSwIncludeTree(readTree, this.swPreIncludeTree),
    swMainIncludeDir: readSwIncludeTree(readTree, this.swMainIncludeTree),
  };

  return rsvp.hash(includePromises).then(function(trees){
    return readTree(serviceWorkerTree).then(function(srcDir){
      var lines = [];
      lines.push("var swEnvironment = " + JSON.stringify(swEnvironment) + ";");
      lines.push("var CACHE_PREFIX = '" + cachePrefix + "';");
      lines.push("var CACHE_VERSION = CACHE_PREFIX+'"+(new Date()).getTime()+"';");

      lines.push("importScripts('" + toolboxDestination + "sw-toolbox.js');");
      lines.push("toolbox.options.cache.name = CACHE_VERSION;");

      if (debug) {
        lines.push("toolbox.options.debug = true;");
      }

      if (swPreIncludeFiles && swPreIncludeFiles.length) {
        lines = lines.concat(swPreIncludeFiles.map(function(file) {
          return fs.readFileSync(file);
        }).join(';\n'));
      }

      if (trees.swPreIncludeDir) {
        getFilesRecursively(trees.swPreIncludeDir, [ "**/*" ]).forEach(function (file) {
          var srcFile = path.join(trees.swPreIncludeDir, file);
          lines.push(fs.readFileSync(srcFile));
        });
      }

      lines.push("var urlsToPrefetch = [");
      if (rootURL) {
        lines.push("    '"+rootURL+"',");
      }
      getFilesRecursively(srcDir, [ "**/*" ]).forEach(function (file, idx, array) {
        lines.push(createArrayLine('    '+JSON.stringify(file), idx, array.length));
      });
      lines.push("];");
      precacheURLs.forEach(function (file, idx, array) {
        lines.push("urlsToPrefetch.push('"+file+"');");
      });
      lines.push("urlsToPrefetch.forEach(function(url) {");
      lines.push("  toolbox.router.any(url, toolbox.cacheFirst);");
      lines.push("});");
      lines.push("toolbox.precache(urlsToPrefetch);");
      setupRoutes(cacheFirstURLs, 'toolbox.cacheFirst', lines);
      setupRoutes(cacheOnlyURLs, 'toolbox.cacheOnly', lines);
      setupRoutes(fastestURLs, 'toolbox.fastest', lines);
      setupRoutes(networkFirstURLs, 'toolbox.networkFirst', lines);

      if (fallback.length) {
        fallback.forEach(function(fallback, idx, array) {
          var fallbackParts = fallback.split(' ');
          if (fallbackParts.length > 1) {
            var fallbackOptions = "{fallbackURL:'"+fallbackParts[1]+"'}";
            lines.push("toolbox.router.any('"+fallbackParts[0]+"',fallbackResponse, "+fallbackOptions+");");
          }
        });
      }

      if (swMainIncludeFiles && swMainIncludeFiles.length) {
        lines = lines.concat(swMainIncludeFiles.map(function(file) {
          return fs.readFileSync(file);
        }).join(';\n'));
      }

      if (trees.swMainIncludeDir) {
        getFilesRecursively(trees.swMainIncludeDir, [ "**/*" ]).forEach(function (file) {
          var srcFile = path.join(trees.swMainIncludeDir, file);
          lines.push(fs.readFileSync(srcFile));
        });
      }

      if (skipWaiting || debug) {
        lines.push("self.addEventListener('install', function(event) {");
         addDebugLine("'Handling install event. Resources to pre-fetch:', urlsToPrefetch", debug, lines);
        if (skipWaiting) {
          lines.push("  if (self.skipWaiting) { self.skipWaiting(); }");
        }
        lines.push("});");
      }

      lines.push(getFileContents('delete-old-caches.js'));
      if (fallback.length) {
        lines.push(getFileContents('fallback-response.js'));
      }

      lines.push(getFileContents('log-debug.js'));
      fs.writeFileSync(path.join(destDir, serviceWorkerFile), lines.join("\n"));


      // Ensure that the toolboxDestination directory exists; if not create it.
      path.join(destDir, toolboxDestination).split('/').reduce(function(p, folder){
        p += folder + '/';
        if(!fs.existsSync(p)) fs.mkdirSync(p);
        return p;
      }, '');

      fs.writeFileSync(path.join(destDir, toolboxDestination, 'sw-toolbox.js'), fs.readFileSync(swToolboxFile));
      if (sourcemaps) {
        fs.writeFileSync(path.join(destDir, toolboxDestination, 'sw-toolbox.js.map'), fs.readFileSync(swToolboxMapFile));
      }
    });
  });
};

BroccoliServiceWorker.prototype.addExternalFile = function(file) {
  this.externalFiles.push(file);
};

function addDebugLine(consoleText, debug, lines) {
  if (debug) {
    lines.push("console.log("+consoleText+");");
  }
}

function createArrayLine(line, idx, arrayLength) {
  var arrayLine = line;
  if ((idx+1) < arrayLength) {
    arrayLine += ",";
  }
  return arrayLine;
}

function getFilesRecursively(dir, globPatterns) {
  try {
    return helpers.multiGlob(globPatterns, { cwd: dir }).filter(function(file){
      var srcFile = path.join(dir, file);
      var stat = fs.lstatSync(srcFile);
      return (stat.isFile()  || stat.isSymbolicLink());
    });
  } catch (ex) {
    return [];
  }
}

function getFileContents(fileName) {
  var filePath = [ __dirname, fileName].join('/');
  return fs.readFileSync(filePath);
}

function printPath(path) {
  if (path instanceof RegExp) {
    return path.toString();
  } else {
    return JSON.stringify(path);
  }
}

function setupRoutes(routeUrls, handler, lines) {
  if (routeUrls.length) {
    routeUrls.forEach(function(cacheURL, idx, array) {
      var method = 'any';
      var options;
      var origin;

      if (typeof cacheURL === 'object' && (cacheURL instanceof RegExp === false)) {
        origin = cacheURL.options && cacheURL.options.origin;
        if (origin) {
          cacheURL.options.origin = '[origin]';
        }
        options = JSON.stringify(cacheURL.options);
        if (cacheURL.method) {
          method = cacheURL.method;
        }
        cacheURL = cacheURL.route;
      }
      var line = 'toolbox.router.'+method+'('+printPath(cacheURL)+',' + handler;

      if (options) {
        line += ', ';
        line += options;
      }

      if (origin) {
        line = line.replace('"[origin]"', printPath(origin));
      }

      line += ');';

      lines.push(line);
    });
  }
}

function readSwIncludeTree(readTree, swIncludeTree) {
  if (swIncludeTree) {
    return readTree(swIncludeTree);
  } else {
    return rsvp.resolve();
  }
}

module.exports = BroccoliServiceWorker;
