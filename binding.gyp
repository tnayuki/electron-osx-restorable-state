{
  "targets": [
    {
      "target_name": "restorable_state",
      "conditions": [
        ["OS=='mac'", {
          "sources": ["src/restorable_state.mm"],
          "xcode_settings": {
            "OTHER_CPLUSPLUSFLAGS": ["-std=c++17", "-ObjC++"],
            "OTHER_LDFLAGS": ["-framework Cocoa"]
          },
          "include_dirs": [
            "<!@(node -p \"require('node-addon-api').include\")"
          ],
          "defines": ["NAPI_DISABLE_CPP_EXCEPTIONS"]
        }, {
          "type": "none"
        }]
      ]
    }
  ]
}
