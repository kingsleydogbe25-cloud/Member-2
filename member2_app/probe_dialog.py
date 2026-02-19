import webview

def callback():
    from webview import FileDialog
    w = webview.windows[0]
    print('invoking dialog')
    # correct filter string
    path = w.create_file_dialog(FileDialog.SAVE, file_types=('JSON (*.json)',))
    print('dialog returned', path, type(path))
    return

webview.create_window('Test', html='<h1>hello</h1>', js_api=None)
webview.start(callback)
