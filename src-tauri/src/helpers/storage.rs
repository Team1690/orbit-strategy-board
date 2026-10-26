//! Persistence primitives.
//!
//! A concrete Tauri persistence plugin can implement [`KeyValueStore`].

use std::collections::BTreeMap;

use serde_json::Value;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    Backend(String),
}

impl std::fmt::Display for StorageError {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Backend(message) => write!(formatter, "storage backend error: {message}"),
        }
    }
}

impl std::error::Error for StorageError {}

/// Minimal synchronous interface suitable for an in-memory store, a database
/// transaction, or a Tauri command backed by a persistence plugin.
pub trait KeyValueStore {
    fn get(&self, key: &str) -> Result<Option<Value>, StorageError>;
    fn get_many(&self, keys: &[String]) -> Result<Vec<Option<Value>>, StorageError> {
        keys.iter().map(|key| self.get(key)).collect()
    }
    fn set(&mut self, key: &str, value: Value) -> Result<(), StorageError>;
    fn delete(&mut self, key: &str) -> Result<(), StorageError>;
    fn clear(&mut self) -> Result<(), StorageError>;
    fn entries(&self) -> Result<Vec<(String, Value)>, StorageError>;
}

/// Test-friendly implementation. Production code should wrap the selected
/// desktop/mobile persistence backend behind the trait above.
#[derive(Debug, Default, Clone)]
pub struct MemoryStore {
    values: BTreeMap<String, Value>,
}

impl KeyValueStore for MemoryStore {
    fn get(&self, key: &str) -> Result<Option<Value>, StorageError> {
        Ok(self.values.get(key).cloned())
    }

    fn set(&mut self, key: &str, value: Value) -> Result<(), StorageError> {
        self.values.insert(key.to_owned(), value);
        Ok(())
    }

    fn delete(&mut self, key: &str) -> Result<(), StorageError> {
        self.values.remove(key);
        Ok(())
    }

    fn clear(&mut self) -> Result<(), StorageError> {
        self.values.clear();
        Ok(())
    }

    fn entries(&self) -> Result<Vec<(String, Value)>, StorageError> {
        Ok(self
            .values
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn store_round_trip_and_get_many_preserve_missing_keys() {
        let mut store = MemoryStore::default();
        store.set("one", json!(1)).unwrap();
        let values = store
            .get_many(&["one".to_owned(), "missing".to_owned()])
            .unwrap();
        assert_eq!(values, vec![Some(json!(1)), None]);
        store.delete("one").unwrap();
        assert_eq!(store.get("one").unwrap(), None);
        store.set("two", json!(2)).unwrap();
        store.clear().unwrap();
        assert!(store.entries().unwrap().is_empty());
    }
}
