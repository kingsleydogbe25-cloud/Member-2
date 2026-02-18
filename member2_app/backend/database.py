import json
import os
import shutil
from datetime import datetime

class Database:
    def __init__(self, data_dir=None):
        if data_dir is None:
            # Default to the 'data' directory in the project root (one level up from backend/)
            base_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
            self.data_dir = os.path.join(base_dir, 'data')
        else:
            self.data_dir = data_dir
        
        self.members_file = os.path.join(self.data_dir, 'members.json')
        self.schema_file = os.path.join(self.data_dir, 'schema.json')
        self.categories_file = os.path.join(self.data_dir, 'categories.json')
        self.settings_file = os.path.join(self.data_dir, 'settings.json')
        self.init_db()

        # Load data into memory
        self.members = self.load_json(self.members_file)
        self.schema = self.load_json(self.schema_file)
        self.categories = self.load_json(self.categories_file)
        self.settings = self.load_json(self.settings_file)

    def init_db(self):
        if not os.path.exists(self.data_dir):
            os.makedirs(self.data_dir)
        
        self._ensure_file(self.members_file, [])
        self._ensure_file(self.schema_file, [{"id": "name", "label": "Name", "type": "text"}, {"id": "dob", "label": "Date of Birth", "type": "date"}])
        self._ensure_file(self.categories_file, ["General"])
        self._ensure_file(self.settings_file, {"theme": "dark", "default_category": "General", "date_format": "YYYY-MM-DD"})

    def _ensure_file(self, filepath, default_data):
        if not os.path.exists(filepath):
            with open(filepath, 'w') as f:
                json.dump(default_data, f, indent=4)

    def load_json(self, filepath):
        try:
            with open(filepath, 'r') as f:
                return json.load(f)
        except Exception as e:
            print(f"Error loading {filepath}: {e}")
            return []

    def save_json(self, filepath, data):
        try:
            with open(filepath, 'w') as f:
                json.dump(data, f, indent=4)
            return True
        except Exception as e:
            print(f"Error saving {filepath}: {e}")
            return False

    def get_members(self):
        return self.members

    def save_member(self, member):
        # Check if updating or new
        for i, m in enumerate(self.members):
            if m.get('id') == member.get('id'):
                self.members[i] = member
                break
        else:
            self.members.append(member)
        return self.save_json(self.members_file, self.members)
    
    def save_members_bulk(self, new_members):
        # Simple append/merge strategy
        existing_ids = {m.get('id'): i for i, m in enumerate(self.members)}
        
        for nm in new_members:
            if 'id' in nm and nm['id'] in existing_ids:
                self.members[existing_ids[nm['id']]] = nm
            else:
                self.members.append(nm)
        return self.save_json(self.members_file, self.members)

    def delete_member(self, member_id):
        self.members = [m for m in self.members if m.get('id') != member_id]
        return self.save_json(self.members_file, self.members)

    def get_schema(self):
        return self.schema

    def save_schema(self, schema):
        self.schema = schema
        return self.save_json(self.schema_file, self.schema)

    def get_categories(self):
        return self.categories

    def save_categories(self, categories):
        self.categories = categories
        return self.save_json(self.categories_file, self.categories)

    def delete_category(self, category_name):
        if category_name in self.categories:
            self.categories.remove(category_name)
            self.save_categories(self.categories)
            
            # Update members who had this category
            updated = False
            for m in self.members:
                if m.get('category') == category_name:
                    m['category'] = 'Uncategorized'
                    updated = True
            if updated:
                self.save_json(self.members_file, self.members)
            return True
        return False

    def backup_data(self):
        timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")
        backup_dir = os.path.join(self.data_dir, 'backups', timestamp)
        if not os.path.exists(backup_dir):
            os.makedirs(backup_dir)
        
        shutil.copy2(self.members_file, backup_dir)
        shutil.copy2(self.schema_file, backup_dir)
        shutil.copy2(self.categories_file, backup_dir)
        return timestamp # Return ID instead of full path for UI

    def get_backups(self):
        backups_dir = os.path.join(self.data_dir, 'backups')
        if not os.path.exists(backups_dir):
            return []
        # Return list of folder names (timestamps)
        return sorted([d for d in os.listdir(backups_dir) if os.path.isdir(os.path.join(backups_dir, d))], reverse=True)

    def restore_backup(self, backup_id):
        backup_dir = os.path.join(self.data_dir, 'backups', backup_id)
        if not os.path.exists(backup_dir):
            return False
            
        try:
            shutil.copy2(os.path.join(backup_dir, 'members.json'), self.data_dir)
            shutil.copy2(os.path.join(backup_dir, 'schema.json'), self.data_dir)
            shutil.copy2(os.path.join(backup_dir, 'categories.json'), self.data_dir)
            
            # Reload data into memory
            self.members = self.load_json(self.members_file)
            self.schema = self.load_json(self.schema_file)
            self.categories = self.load_json(self.categories_file)
            
            return True
        except Exception as e:
            print(f"Restore failed: {e}")
            return False

    def delete_backup(self, backup_id):
        backup_dir = os.path.join(self.data_dir, 'backups', backup_id)
        if not os.path.exists(backup_dir):
            return False
        try:
            shutil.rmtree(backup_dir)
            return True
        except Exception as e:
            print(f"Delete backup failed: {e}")
            return False

    def get_settings(self):
        return self.settings

    def save_settings(self, settings):
        self.settings = settings
        return self.save_json(self.settings_file, self.settings)
