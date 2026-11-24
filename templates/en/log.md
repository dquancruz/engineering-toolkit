---
id: LOG
owner: {{owner_yaml}}
---

# Log

<!--
Append only. Previous entries are never deleted or edited: if something was wrong,
add a new entry that corrects it and links to the earlier one.
Each entry carries its date and separates what is verified from what is not.
-->

Format of each entry:

```
## YYYY-MM-DD (use the real date)

### Verified
- What was checked, and how or with which source.

### Unverified
- What is assumed or was heard, and who said it.
```

## {{date}}

### Verified
- The base project documents were created with `engkit init`.

### Unverified
- Nothing for now.
