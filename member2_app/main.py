#from trial_guard import check_trial
#check_trial()
#.....................Above is related 30 Days trial..............

import webview
import os
import sys

# Add current directory to path to import backend modules
sys.path.append(os.path.dirname(os.path.abspath(__file__)))

from backend.api import Api

def main():
    api = Api()
    
    # Point to the web/index.html file
    # Use absolute path relative to script file or _MEIPASS if bundled
    if hasattr(sys, '_MEIPASS'):
        base_dir = sys._MEIPASS
    else:
        base_dir = os.path.dirname(os.path.abspath(__file__))
        
    entry_point = os.path.join(base_dir, 'web', 'index.html')
    # Resolve absolute path
    entry_point = "file://" + os.path.abspath(entry_point)

    window = webview.create_window(
        'Member 2 - Data Manager',
        url=entry_point,
        js_api=api,
        width=1200,
        height=800,
        resizable=True,
        background_color='#1a1a1a'
    )
    
    # disable debug mode to prevent developer tools from opening
    webview.start(debug=False)

if __name__ == '__main__':
    main()
