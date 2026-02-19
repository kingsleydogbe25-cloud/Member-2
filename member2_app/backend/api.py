import json
import uuid
import csv
import io
import os
import base64
from backend.database import Database

class Api:
    def __init__(self):
        self.db = Database()
        # Auto-backup on startup
        try:
            print("Creating auto-backup...")
            self.db.backup_data()
        except Exception as e:
            print(f"Auto-backup failed: {e}")

    def get_members(self):
        return self.db.get_members()

    def save_member(self, member):
        # Ensure member has an ID
        if 'id' not in member or not member['id']:
            member['id'] = str(uuid.uuid4())
        
        if self.db.save_member(member):
            return {"status": "success", "message": "Member saved successfully", "member": member}
        return {"status": "error", "message": "Failed to save member"}

    def delete_member(self, member_id):
        if self.db.delete_member(member_id):
            return {"status": "success", "message": "Member deleted successfully"}
        return {"status": "error", "message": "Failed to delete member"}

    def get_schema(self):
        return self.db.get_schema()

    def save_schema(self, schema):
        if self.db.save_schema(schema):
            return {"status": "success", "message": "Schema updated successfully"}
        return {"status": "error", "message": "Failed to update schema"}

    def get_categories(self):
        return self.db.get_categories()
    
    def save_categories(self, categories):
        if self.db.save_categories(categories):
            return {"status": "success", "message": "Categories updated successfully"}
        return {"status": "error", "message": "Failed to update categories"}

    def delete_category(self, category):
        if self.db.delete_category(category):
            return {"status": "success", "message": f"Category '{category}' deleted"}
        return {"status": "error", "message": "Failed to delete category"}

    def backup_data(self):
        timestamp = self.db.backup_data()
        if timestamp:
            return {"status": "success", "message": f"Backup created: {timestamp}"}
        return {"status": "error", "message": "Backup failed"}
    
    def get_backups(self):
        return self.db.get_backups()
    
    def restore_backup(self, backup_id):
        if self.db.restore_backup(backup_id):
            return {"status": "success", "message": f"Restored backup {backup_id}"}
        return {"status": "error", "message": "Restore failed"}

    def delete_backup(self, backup_id):
        if self.db.delete_backup(backup_id):
            return {"status": "success", "message": f"Backup {backup_id} deleted"}
        return {"status": "error", "message": "Delete failed"}

    def import_members(self, member_list):
        # Validate member_list is a list
        if not isinstance(member_list, list):
             return {"status": "error", "message": "Invalid data format"}
        
        # Ensure IDs
        count = 0
        for m in member_list:
            if 'id' not in m or not m['id']:
                m['id'] = str(uuid.uuid4())
            count += 1
            
        if self.db.save_members_bulk(member_list):
            return {"status": "success", "message": f"Imported {count} members"}
        return {"status": "error", "message": "Import failed"}

    def export_csv(self):
        # existing behaviour (returns text) for backwards compatibility
        members = self.db.get_members()
        schema = self.db.get_schema()
        
        if not members:
            return ""
            
        output = io.StringIO()
        # Define headers: 'id', 'short_id' + Schema fields + 'category'
        # Filter schema fields to unique IDs just in case
        schema_ids = [f['id'] for f in schema]
        fieldnames = ['id', 'short_id'] + schema_ids + ['category']
        
        # Use restval='' to handle missing keys gracefully
        writer = csv.DictWriter(output, fieldnames=fieldnames, extrasaction='ignore', restval='')
        writer.writeheader()
        
        for m in members:
            writer.writerow(m)
            
        return output.getvalue()

    def export_json_file(self):
        """Open save dialog and write members data as pretty JSON."""
        members = self.db.get_members()
        if not members:
            return {"status": "error", "message": "No members to export"}

        try:
            # use pywebview dialog to ask for location; must reference the window instance
            import webview
            from webview import FileDialog
            w = webview.windows[0] if webview.windows else None
            if not w:
                return {"status": "error", "message": "No window available"}
            # correct filter string format: 'Description (*.ext)'
            path = w.create_file_dialog(FileDialog.SAVE, file_types=('JSON (*.json)',), save_filename='members_export.json')
            if not path:
                return {"status": "error", "message": "Cancelled"}
            filepath = path[0] if isinstance(path, (list, tuple)) else path
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(members, f, indent=2)
            return {"status": "success", "path": filepath}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def export_csv_file(self):
        """Open save dialog and write members data as CSV."""
        members = self.db.get_members()
        schema = self.db.get_schema()
        if not members:
            return {"status": "error", "message": "No members to export"}
        try:
            import webview
            from webview import FileDialog
            w = webview.windows[0] if webview.windows else None
            if not w:
                return {"status": "error", "message": "No window available"}
            path = w.create_file_dialog(FileDialog.SAVE, file_types=('CSV (*.csv)',), save_filename='members_export.csv')
            if not path:
                return {"status": "error", "message": "Cancelled"}
            filepath = path[0] if isinstance(path, (list, tuple)) else path
            # write using earlier logic
            schema_ids = [f['id'] for f in schema]
            fieldnames = ['id', 'short_id'] + schema_ids + ['category']
            with open(filepath, 'w', newline='', encoding='utf-8') as csvfile:
                writer = csv.DictWriter(csvfile, fieldnames=fieldnames, extrasaction='ignore', restval='')
                writer.writeheader()
                for m in members:
                    writer.writerow(m)
            return {"status": "success", "path": filepath}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def export_member_file(self, member):
        """Open save dialog and write a single member as pretty JSON."""
        if not isinstance(member, dict):
            return {"status": "error", "message": "Invalid member data"}

        try:
            import webview
            from webview import FileDialog
            w = webview.windows[0] if webview.windows else None
            if not w:
                return {"status": "error", "message": "No window available"}

            default_name = f"member_{member.get('id','member')}.json"
            path = w.create_file_dialog(FileDialog.SAVE, file_types=('JSON (*.json)',), save_filename=default_name)
            if not path:
                return {"status": "error", "message": "Cancelled"}
            filepath = path[0] if isinstance(path, (list, tuple)) else path
            with open(filepath, 'w', encoding='utf-8') as f:
                json.dump(member, f, indent=2)
            return {"status": "success", "path": filepath}
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def save_pdf(self, base64_str):
        """Save a base64-encoded PDF string to disk via dialog."""
        if not base64_str:
            return {"status": "error", "message": "No PDF data"}
        try:
            import webview
            from webview import FileDialog
            w = webview.windows[0] if webview.windows else None
            if not w:
                return {"status": "error", "message": "No window available"}
            path = w.create_file_dialog(FileDialog.SAVE, file_types=('PDF (*.pdf)',), save_filename='members_report.pdf')
            if not path:
                return {"status": "error", "message": "Cancelled"}
            filepath = path[0] if isinstance(path, (list, tuple)) else path
            if "," in base64_str:
                base64_str = base64_str.split(",", 1)[1]
            data = base64.b64decode(base64_str)
            with open(filepath, 'wb') as f:
                f.write(data)
            return {"status": "success", "path": filepath}
        except Exception as e:
            return {"status": "error", "message": str(e)}
    
    def save_image(self, base64_str):
        try:
            # Ensure images directory exists
            img_dir = os.path.join("data", "images")
            if not os.path.exists(img_dir):
                os.makedirs(img_dir)
            
            # Use UUID for filename
            filename = f"{uuid.uuid4()}.png"
            filepath = os.path.join(img_dir, filename)
            
            # Decode base64 (expecting "data:image/png;base64,.....")
            if "," in base64_str:
                base64_str = base64_str.split(",")[1]
                
            img_data = base64.b64decode(base64_str)
            
            with open(filepath, "wb") as f:
                f.write(img_data)
                
            # Return absolute path for frontend to use via file:// or simple filename if server handled
            # Since we are using pywebview with file:// access to index.html, 
            # we need to be careful. App logic might need to handle path.
            # Let's return the relative path for the database, frontend can resolve it.
            return {"status": "success", "filename": filename, "path": os.path.abspath(filepath)}
            
        except Exception as e:
            return {"status": "error", "message": str(e)}

    def delete_members(self, member_ids):
        # Validate input
        if not isinstance(member_ids, list):
             return {"status": "error", "message": "Invalid format"}
        
        count = 0
        for pid in member_ids:
            if self.db.delete_member(pid):
                count += 1
                
        return {"status": "success", "message": f"Deleted {count} members"}

    def get_settings(self):
        return self.db.get_settings()

    def save_settings(self, settings):
        if self.db.save_settings(settings):
            return {"status": "success", "message": "Settings saved"}
        return {"status": "error", "message": "Failed to save settings"}
