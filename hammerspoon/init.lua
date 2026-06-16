local config = {
  endpoint = "https://<your-worker-domain>/update",
  secretService = "frontmost",
  secretAccount = "write-secret",
  userAgent = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"
}

local uploadedIconsPath = hs.configdir .. "/frontmost-uploaded-icons.json"
local logPath = hs.configdir .. "/frontmost.log"
local uploadedIcons = {}
local secret = nil

local function log(message)
  local file = io.open(logPath, "a")
  if not file then return end
  file:write(os.date("!%Y-%m-%dT%H:%M:%SZ ") .. tostring(message) .. "\n")
  file:close()
end

local function shellQuote(value)
  return "'" .. tostring(value):gsub("'", "'\\''") .. "'"
end

local function readSecret()
  local command = table.concat({
    "/usr/bin/security find-generic-password",
    "-a " .. shellQuote(config.secretAccount),
    "-s " .. shellQuote(config.secretService),
    "-w"
  }, " ")
  local output, ok = hs.execute(command, true)
  if not ok then return nil end
  return output:gsub("%s+$", "")
end

local function loadUploadedIcons()
  local file = io.open(uploadedIconsPath, "r")
  if not file then return end
  local content = file:read("*a")
  file:close()
  uploadedIcons = hs.json.decode(content) or {}
end

local function saveUploadedIcons()
  local file = io.open(uploadedIconsPath, "w")
  if not file then return end
  file:write(hs.json.encode(uploadedIcons))
  file:close()
end

local function report(payload)
  if not secret then
    log("missing keychain secret")
    return
  end

  hs.http.asyncPost(
    config.endpoint,
    hs.json.encode(payload),
    {
      ["Authorization"] = "Bearer " .. secret,
      ["Content-Type"] = "application/json",
      ["User-Agent"] = config.userAgent
    },
    function(code, body)
      if code < 200 or code >= 300 then
        log("report failed: code=" .. tostring(code) .. " body=" .. tostring(body))
      end
    end
  )
end

local function urlEncode(value)
  return tostring(value):gsub("([^%w%._%-])", function(char)
    return string.format("%%%02X", string.byte(char))
  end)
end

local function iconEndpoint(bundleId)
  return config.endpoint:gsub("/update$", "/icon/" .. urlEncode(bundleId))
end

local function uploadIcon(bundleId)
  if not secret then return end
  if uploadedIcons[bundleId] then return end

  local image = hs.image.imageFromAppBundle(bundleId)
  if not image then
    log("icon missing image: " .. tostring(bundleId))
    return
  end

  local resized = image:setSize({ w = 64, h = 64 }, true)
  local png = resized:encodeAsURLString(false, "PNG")
  if not png then
    log("icon encode failed: " .. tostring(bundleId))
    return
  end

  local comma = png:find(",", 1, true)
  local base64 = comma and png:sub(comma + 1) or png
  local bytes = hs.base64.decode(base64)
  if not bytes then
    log("icon base64 decode failed: " .. tostring(bundleId))
    return
  end

  hs.http.doAsyncRequest(
    iconEndpoint(bundleId),
    "POST",
    bytes,
    {
      ["Authorization"] = "Bearer " .. secret,
      ["Content-Type"] = "image/png",
      ["User-Agent"] = config.userAgent
    },
    function(code, body)
      if code >= 200 and code < 300 then
        uploadedIcons[bundleId] = true
        saveUploadedIcons()
        log("icon uploaded: " .. tostring(bundleId))
      else
        log("icon upload failed: " .. tostring(bundleId) .. " code=" .. tostring(code) .. " body=" .. tostring(body))
      end
    end
  )
end

local function reportCurrentApp()
  local app = hs.application.frontmostApplication()
  if not app then return end

  local bundleId = app:bundleID()
  local name = app:name()
  if not bundleId or not name then return end

  report({ type = "switch", bundleId = bundleId, name = name })
  uploadIcon(bundleId)
end

loadUploadedIcons()
secret = readSecret()
log("frontmost config loaded")
if not secret then
  hs.notify.new({
    title = "frontmost",
    informativeText = "Missing Keychain secret: service=" .. config.secretService .. ", account=" .. config.secretAccount
  }):send()
end
reportCurrentApp()

appWatcher = hs.application.watcher.new(function(name, event, app)
  if event ~= hs.application.watcher.activated then return end
  if not app then return end

  local bundleId = app:bundleID()
  if not bundleId or not name then return end

  report({ type = "switch", bundleId = bundleId, name = name })
  uploadIcon(bundleId)
end):start()

heartbeatTimer = hs.timer.doEvery(60, function()
  report({ type = "heartbeat" })
end)

caffeinateWatcher = hs.caffeinate.watcher.new(function(event)
  if event == hs.caffeinate.watcher.screensDidLock then
    report({ type = "lock" })
  elseif event == hs.caffeinate.watcher.screensDidUnlock then
    report({ type = "unlock" })
    reportCurrentApp()
  elseif event == hs.caffeinate.watcher.systemWillSleep then
    report({ type = "sleep" })
  elseif event == hs.caffeinate.watcher.systemDidWake then
    report({ type = "wake" })
    reportCurrentApp()
  end
end):start()

hs.shutdownCallback = function()
  if not secret then return end

  hs.http.post(
    config.endpoint,
    hs.json.encode({ type = "sleep" }),
    {
      ["Authorization"] = "Bearer " .. secret,
      ["Content-Type"] = "application/json",
      ["User-Agent"] = config.userAgent
    }
  )
end
