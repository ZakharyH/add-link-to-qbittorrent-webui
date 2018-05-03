// Create root context menu item
browser.contextMenus.create({
    id: "root-Default",
    title: browser.i18n.getMessage("contextItemTitle"),
    icons: {
        "16": browser.extension.getURL("icons/qbittorrent-tray.svg")
    },
    contexts: ["link"]
});

// Generate context menu item from a window
var generateItem = function (profileName) {
    let item = {
        id: "child-" + profileName,
        title: profileName,
        contexts: ["link"],
        parentId: "root-Default"
    };
    return item;
}

var options = new Proxy({}, {
    set: function(target, prop, value) {
        console.log("Add submenu for new profile: " + prop);
        switch (Object.keys(target).length) {
            case (0):       // Initialization
                break;
            case (1):       // Second item
                browser.contextMenus.create(generateItem("Default"));
            default:        // Item 3++
                browser.contextMenus.create(generateItem(prop));
                break;
        }
        return Reflect.set(...arguments);
    },
    get: function(target, prop, value) {    // Having this removes warning
        return Reflect.get(...arguments);
    },
    deleteProperty: function(target, prop) {
        console.log("Deleting submenu for profile" + prop);
        switch (Object.keys(target).length) {
            case (2):       // Last 2 items
                browser.contextMenus.remove("child-Default");
            default:        // N items > 2
                browser.contextMenus.remove("child-" + prop);
                break;
        }
        return Reflect.deleteProperty(...arguments);
    }
});

browser.storage.local.get().then(results => {
    // Fix for FF < 52
    if (results.length > 0) {
      results = results[0];
    }
    for (const key in results) {
        let [ keyName, profileName ] = key.split("-");
        if (profileName === undefined) {
            profileName = "Default";
        }
        if (!Object.keys(options).includes(profileName)) {
            options[profileName] = {};
        }
        options[profileName][keyName] = results[key];
    }
    if (!options.Default.qbtUrl) {
        browser.tabs.create({ url: browser.extension.getURL("options.html"), active: true });
        createNotification(browser.i18n.getMessage("errorNoQbtURL"));
    }
});

browser.storage.onChanged.addListener((changes, areaName) => {
    if (areaName === "local") {
        let deleteKeys = [];
        for (let key in changes) {
            let [ keyName, profileName ] = key.split("-");
            if (profileName === undefined) {
                profileName = "Default";
            }
            if (!Object.keys(options).includes(profileName)) {
                options[profileName] = {};
            }
            if (changes[key].newValue === undefined) {
                delete options[profileName][keyName];
                if (!deleteKeys.includes(profileName)) {
                    deleteKeys.push(profileName);
                }
            } else {
                options[profileName][keyName] = changes[key].newValue;
            }
        }
        for (let profileName of deleteKeys) {
            delete options[profileName];
        }
    }
});

var createNotification = function (message) {
    browser.notifications.create("add-link-to-qbt-notif", {
        type: "basic",
        iconUrl: browser.extension.getURL("icons/qbittorrent-tray.svg"),
        title: browser.i18n.getMessage("notificationTitle"),
        message: message
    });
};

var doPost = function (url, profile, tabUrl) {
    console.log("Do post url: " + url + "; qbtUrl: " + options[profile].qbtUrl + "; tabUrl: " + tabUrl);

    if (url.match(/^https?:\/\/|magnet:|bt:\/\/bc\//)) {
        browser.cookies.getAll({url: tabUrl}).then(cookies => {
            var cookiesStr = "";
            for (var cookie of cookies) {
                cookiesStr += cookie.name + "=" + cookie.value + ";";
            }

            var formData = new FormData();

            // Populate FormData
            formData.append("urls", url);
            formData.append("cookie", cookiesStr);
            if (options[profile].savepath)           { formData.append("savepath", options[profile].savepath); }
            if (options[profile].category)           { formData.append("category", options[profile].category); }
            if (options[profile].skipChecking)       { formData.append("skip_checking", options[profile].skipChecking); }
            if (options[profile].paused)             { formData.append("paused", options[profile].paused); }
            if (options[profile].rootFolder)         { formData.append("root_folder", options[profile].rootFolder); }
            if (options[profile].rename)             { formData.append("rename", options[profile].rename); }
            if (options[profile].upLimit)            { formData.append("upLimit", options[profile].upLimit); }
            if (options[profile].dlLimit)            { formData.append("dlLimit", options[profile].dlLimit); }
            if (options[profile].sequentialDownload) { formData.append("sequentialDownload", options[profile].sequentialDownload); }
            if (options[profile].firstLastPiecePrio) { formData.append("firstLastPiecePrio", options[profile].firstLastPiecePrio); }

            var req = new XMLHttpRequest();
            req.open("post", options[profile].qbtUrl + (options[profile].qbtUrl.match(/[^\/]$/) ? "/" : "") + "command/download");
            req.withCredentials = true;
            req.addEventListener("load", function() {
                console.log(req.status, req.statusText);
                createNotification(req.responseText ? req.responseText : req.status === 403 ? browser.i18n.getMessage("errorCookieExpired") : (req.status + " " + req.statusText));
                if (!req.responseText && req.status === 403) {
                    browser.tabs.create({ url: options[profile].qbtUrl, active: true });
                }
            });
            req.addEventListener("error", function() {
                console.log("XMLHttpRequest error occured");
                createNotification(browser.i18n.getMessage("errorXHR"));
            });
            req.send(formData);
        });
    } else {
        console.log("URL not supported!");
        createNotification(browser.i18n.getMessage("errorNotSupported"));
    }
};

// On context menu item clicked
browser.contextMenus.onClicked.addListener((info, tab) => {
    let profileName = info.menuItemId.split("-")[1];
    console.log("Add " + info.linkUrl + " now with profile: " + profileName);

    // Check if qbtUrl set
    if (!options[profileName].qbtUrl) {
        browser.tabs.create({ url: browser.extension.getURL("options.html"), active: true });
        createNotification(browser.i18n.getMessage("errorNoQbtURL"));
    } else {
        // Check for cookie
        browser.cookies.get({ name: "SID", url: options[profileName].qbtUrl.replace(/:[0-9]+\/?$/, "") }).then((cookie) => {
            if (cookie !== null && cookie.value) {
                doPost(info.linkUrl, profileName, tab.url);
            } else {
                // No cookie, open page
                console.log("Cannot find cookie, opening web ui..." );
                createNotification(browser.i18n.getMessage("errorNoCookie"));
                browser.tabs.create({ url: options[profileName].qbtUrl, active: true });
            }
        });
    }
});
