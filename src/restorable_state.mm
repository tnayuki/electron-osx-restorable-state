#import <Cocoa/Cocoa.h>
#import <napi.h>
#import <objc/message.h>
#import <objc/runtime.h>

// ---------------------------------------------------------------------------
// 1. Restoration class — holds completionHandlers until Electron creates
//    BrowserWindows, then passes them back to macOS.
// ---------------------------------------------------------------------------

static NSMutableDictionary<NSString *, void (^)(NSWindow *, NSError *)>
    *sPendingHandlers;

@interface RestorableStateRestorer : NSObject <NSWindowRestoration>
@end

@implementation RestorableStateRestorer

+ (void)restoreWindowWithIdentifier:
            (NSUserInterfaceItemIdentifier)identifier
                              state:(NSCoder *)state
                  completionHandler:
                      (void (^)(NSWindow *, NSError *))completionHandler {
  if (!sPendingHandlers)
    sPendingHandlers = [NSMutableDictionary new];
  sPendingHandlers[identifier] = [completionHandler copy];
  [NSApp extendStateRestoration];
}

@end

static const void *kUserDataKey = &kUserDataKey;
static BOOL sSwizzleInstalled = NO;

static IMP sOriginalEncodeRestorableState;
static IMP sOriginalRestoreStateWithCoder;

static void Swizzled_encodeRestorableStateWithCoder(id self, SEL _cmd,
                                                     NSCoder *coder) {
  // Call original (NSWindow's frame/state encoding)
  ((void (*)(id, SEL, NSCoder *))sOriginalEncodeRestorableState)(self, _cmd,
                                                                  coder);

  // Encode custom user data stored on the window
  NSDictionary *userData = objc_getAssociatedObject(self, kUserDataKey);
  if (userData) {
    [coder encodeObject:userData forKey:@"electronRestorableState"];
  }
}

static void Swizzled_restoreStateWithCoder(id self, SEL _cmd, NSCoder *coder) {
  // Call original (NSWindow's frame/state restoring)
  ((void (*)(id, SEL, NSCoder *))sOriginalRestoreStateWithCoder)(self, _cmd,
                                                                  coder);

  // Decode custom user data
  NSDictionary *userData =
      [coder decodeObjectOfClasses:[NSSet setWithArray:@[
               [NSDictionary class], [NSArray class], [NSString class],
               [NSNumber class], [NSData class]
             ]]
                            forKey:@"electronRestorableState"];
  if (userData) {
    objc_setAssociatedObject(self, kUserDataKey, userData,
                             OBJC_ASSOCIATION_COPY_NONATOMIC);
  }
}

static BOOL sShouldTerminateInstalled = NO;

static IMP sOriginalShouldTerminate;
static BOOL sFlushingState = NO;

static NSApplicationTerminateReply
Swizzled_applicationShouldTerminate(id self, SEL _cmd, NSApplication *app) {
  if (sFlushingState) {
    // Cancel immediately — [super terminate:] returns without entering a
    // modal loop. We only need the terminate: call to trigger macOS's state
    // saving; actual quit is handled by Electron.
    return NSTerminateCancel;
  }
  // Normal path: Electron doesn't implement this, so return default
  if (sOriginalShouldTerminate) {
    return ((NSApplicationTerminateReply(*)(id, SEL, NSApplication *))
                sOriginalShouldTerminate)(self, _cmd, app);
  }
  return NSTerminateNow;
}

static void InstallShouldTerminate() {
  if (sShouldTerminateInstalled)
    return;

  // Add or swizzle applicationShouldTerminate: on the delegate
  id delegate = [NSApp delegate];
  if (delegate) {
    Class delCls = [delegate class];
    SEL shouldSel = @selector(applicationShouldTerminate:);
    Method shouldM = class_getInstanceMethod(delCls, shouldSel);
    if (shouldM) {
      sOriginalShouldTerminate =
          method_setImplementation(shouldM,
                                   (IMP)Swizzled_applicationShouldTerminate);
    } else {
      // Electron doesn't implement this — add it
      class_addMethod(delCls, shouldSel,
                      (IMP)Swizzled_applicationShouldTerminate, "I@:@");
    }
  }

  sShouldTerminateInstalled = YES;
}

static void InstallSwizzle(NSWindow *win) {
  if (sSwizzleInstalled)
    return;

  InstallShouldTerminate();

  Class cls = [win class];

  // Swizzle encodeRestorableStateWithCoder: to include custom data
  SEL encodeSel = @selector(encodeRestorableStateWithCoder:);
  Method encodeM = class_getInstanceMethod(cls, encodeSel);
  if (encodeM) {
    sOriginalEncodeRestorableState =
        method_setImplementation(encodeM,
                                 (IMP)Swizzled_encodeRestorableStateWithCoder);
  }

  // Swizzle restoreStateWithCoder: to recover custom data
  SEL restoreSel = @selector(restoreStateWithCoder:);
  Method restoreM = class_getInstanceMethod(cls, restoreSel);
  if (restoreM) {
    sOriginalRestoreStateWithCoder =
        method_setImplementation(restoreM,
                                 (IMP)Swizzled_restoreStateWithCoder);
  }

  sSwizzleInstalled = YES;
}

// ---------------------------------------------------------------------------
// 3. Helper to convert NSDictionary <-> Napi::Object
// ---------------------------------------------------------------------------

static NSDictionary *NapiObjectToNSDictionary(Napi::Env env,
                                               Napi::Object obj) {
  NSMutableDictionary *dict = [NSMutableDictionary new];
  auto keys = obj.GetPropertyNames();
  for (uint32_t i = 0; i < keys.Length(); i++) {
    std::string key = keys.Get(i).As<Napi::String>().Utf8Value();
    NSString *nsKey = [NSString stringWithUTF8String:key.c_str()];
    Napi::Value val = obj.Get(key);

    if (val.IsString()) {
      dict[nsKey] =
          [NSString stringWithUTF8String:val.As<Napi::String>()
                                            .Utf8Value()
                                            .c_str()];
    } else if (val.IsNumber()) {
      dict[nsKey] = @(val.As<Napi::Number>().DoubleValue());
    } else if (val.IsBoolean()) {
      dict[nsKey] = @(val.As<Napi::Boolean>().Value());
    } else if (val.IsNull() || val.IsUndefined()) {
      // skip
    } else if (val.IsArray()) {
      // Store arrays as JSON string for simplicity
      Napi::Object json = env.Global().Get("JSON").As<Napi::Object>();
      Napi::Function stringify = json.Get("stringify").As<Napi::Function>();
      std::string jsonStr =
          stringify.Call(json, {val}).As<Napi::String>().Utf8Value();
      dict[nsKey] =
          [NSString stringWithUTF8String:jsonStr.c_str()];
    } else if (val.IsObject()) {
      dict[nsKey] = NapiObjectToNSDictionary(env, val.As<Napi::Object>());
    }
  }
  return dict;
}

static Napi::Object NSDictionaryToNapiObject(Napi::Env env,
                                              NSDictionary *dict) {
  Napi::Object obj = Napi::Object::New(env);
  for (NSString *key in dict) {
    std::string cKey = [key UTF8String];
    id val = dict[key];

    if ([val isKindOfClass:[NSString class]]) {
      obj.Set(cKey, Napi::String::New(env, [val UTF8String]));
    } else if ([val isKindOfClass:[NSNumber class]]) {
      // Check if it's a boolean
      if (strcmp([val objCType], @encode(BOOL)) == 0 ||
          strcmp([val objCType], @encode(char)) == 0) {
        obj.Set(cKey, Napi::Boolean::New(env, [val boolValue]));
      } else {
        obj.Set(cKey, Napi::Number::New(env, [val doubleValue]));
      }
    } else if ([val isKindOfClass:[NSDictionary class]]) {
      obj.Set(cKey, NSDictionaryToNapiObject(env, val));
    }
  }
  return obj;
}

// ---------------------------------------------------------------------------
// 4. N-API exports
// ---------------------------------------------------------------------------

static NSWindow *GetNSWindow(Napi::Value handle) {
  auto buf = handle.As<Napi::Buffer<uint8_t>>();
  NSView *view = *reinterpret_cast<NSView *__strong *>(buf.Data());
  return [view window];
}

// enable(nativeHandle, identifier)
// Sets up the window for macOS State Restoration:
// - Installs swizzle (first call only)
// - Installs view encode/restore methods (first call only)
// - Sets identifier, restorable, restorationClass
// - Calls pending completionHandler if one exists
// Returns the restored user data, or undefined.
Napi::Value Enable(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer() || !info[1].IsString()) {
    Napi::TypeError::New(env, "Expected (nativeHandle: Buffer, identifier: string)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSWindow *win = GetNSWindow(info[0]);
  if (!win) {
    Napi::Error::New(env, "Could not get NSWindow from handle")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSString *identifier = [NSString
      stringWithUTF8String:info[1].As<Napi::String>().Utf8Value().c_str()];

  // Install swizzles (once)
  InstallSwizzle(win);

  // Configure the window for State Restoration
  win.identifier = identifier;
  win.restorable = YES;
  win.restorationClass = [RestorableStateRestorer class];

  // If macOS's restoration cycle already called us with a completionHandler
  // for this identifier, pass the window back now.
  if (sPendingHandlers[identifier]) {
    sPendingHandlers[identifier](win, nil);
    [sPendingHandlers removeObjectForKey:identifier];
    [NSApp completeStateRestoration];
  }

  // Check for restored user data (set by restoreStateWithCoder: swizzle)
  NSDictionary *userData = objc_getAssociatedObject(win, kUserDataKey);
  if (userData) {
    return NSDictionaryToNapiObject(env, userData);
  }

  return env.Undefined();
}

// setUserData(nativeHandle, data)
Napi::Value SetUserData(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 2 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected (nativeHandle: Buffer, data: object)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSWindow *win = GetNSWindow(info[0]);
  if (!win) {
    Napi::Error::New(env, "Could not get NSWindow from handle")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  if (info[1].IsNull() || info[1].IsUndefined()) {
    objc_setAssociatedObject(win, kUserDataKey, nil,
                             OBJC_ASSOCIATION_COPY_NONATOMIC);
  } else {
    NSDictionary *dict =
        NapiObjectToNSDictionary(env, info[1].As<Napi::Object>());
    objc_setAssociatedObject(win, kUserDataKey, dict,
                             OBJC_ASSOCIATION_COPY_NONATOMIC);
  }

  // Tell macOS the restorable state changed
  [win invalidateRestorableState];

  return env.Undefined();
}

// getUserData(nativeHandle)
Napi::Value GetUserData(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    Napi::TypeError::New(env, "Expected (nativeHandle: Buffer)")
        .ThrowAsJavaScriptException();
    return env.Undefined();
  }

  NSWindow *win = GetNSWindow(info[0]);
  if (!win) {
    return env.Undefined();
  }

  NSDictionary *userData =
      objc_getAssociatedObject(win, kUserDataKey);
  if (!userData) {
    return env.Undefined();
  }

  return NSDictionaryToNapiObject(env, userData);
}

// getIdentifier(nativeHandle)
Napi::Value GetIdentifier(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    return env.Undefined();
  }

  NSWindow *win = GetNSWindow(info[0]);
  if (!win || !win.identifier) {
    return env.Undefined();
  }

  return Napi::String::New(env, [win.identifier UTF8String]);
}

// invalidateState(nativeHandle)
Napi::Value InvalidateState(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (info.Length() < 1 || !info[0].IsBuffer()) {
    return env.Undefined();
  }

  NSWindow *win = GetNSWindow(info[0]);
  if (win) {
    [win invalidateRestorableState];
  }

  return env.Undefined();
}

// flushState() — trigger [NSApp terminate:] with NSTerminateCancel to save
// restorable state, then return immediately without actually quitting.
// Called from the 'will-quit' event handler.
Napi::Value FlushState(const Napi::CallbackInfo &info) {
  Napi::Env env = info.Env();

  if (!sShouldTerminateInstalled) {
    return env.Undefined();
  }

  // NSTerminateCancel makes [super terminate:] return immediately without
  // entering a modal loop. macOS still saves restorable state during the
  // terminate: call before checking applicationShouldTerminate:.
  sFlushingState = YES;
  struct objc_super superInfo = {NSApp, [NSApplication class]};
  ((void (*)(struct objc_super *, SEL, id))objc_msgSendSuper)(
      &superInfo, @selector(terminate:), nil);
  sFlushingState = NO;

  return env.Undefined();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
  exports.Set("enable", Napi::Function::New(env, Enable));
  exports.Set("setUserData", Napi::Function::New(env, SetUserData));
  exports.Set("getUserData", Napi::Function::New(env, GetUserData));
  exports.Set("getIdentifier", Napi::Function::New(env, GetIdentifier));
  exports.Set("invalidateState", Napi::Function::New(env, InvalidateState));
  exports.Set("flushState", Napi::Function::New(env, FlushState));
  return exports;
}

NODE_API_MODULE(restorable_state, Init)
