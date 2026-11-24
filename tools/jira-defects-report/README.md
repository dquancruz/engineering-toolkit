# 📋 Jira CSV → JSON Reporter

Processes a CSV exported from Jira and generates a JSON report with:
- Assignee, reporter, creation date, last updated
- Summary by status, priority, assignee and reporter
- Optional filter by person name

---

## ✅ Prerequisites

Make sure you have the following installed before running the script:

### 1. Node.js (v18 or higher)
Check if you have it:
```bash
node --version
```
If not installed, download it from: **https://nodejs.org** (choose the LTS version)

### 2. npm (comes with Node.js)
Check if you have it:
```bash
npm --version
```

---

## 🚀 Installation

```bash
# Shared dev dependencies (TypeScript), from the tools/ folder
cd tools
npm ci

# Tool dependencies
cd jira-defects-report
npm ci
```

### Configuration (optional)

Set `JIRA_BASE_URL` to get clickable issue links in the report
(`<JIRA_BASE_URL>/browse/<KEY>`). If it is not set, the `url` field is `null`.

```bash
cp .env.example .env   # then edit the value
export JIRA_BASE_URL=https://your-company.atlassian.net
```

| Variable | Required | Description |
|---|---|---|
| `JIRA_BASE_URL` | No | Base URL of your Jira instance, e.g. `https://your-company.atlassian.net` |

> The script reads `process.env` directly and does not load `.env` files, so export the variable in your shell.

---

## 📥 How to export the CSV from Jira

1. Go to your project in Jira
2. Open the **Issues** view or filter the bugs you want
3. Click the **3 dots** (⋯) or **Export**
4. Select **"CSV (All fields)"**
5. Save the file inside the `jira-defects-report/csv/` folder

---

## ▶️ Usage

```bash
# All defects
npm start -- path/to/file.csv

# Defects filtered by a specific person (assignee or reporter)
npm start -- path/to/file.csv "Full Name"
```

`npm start` compiles the TypeScript and runs the result, so no compiled `.js` is kept in the repo.

**Examples:**
```bash
npm start -- csv/Jira.csv
npm start -- csv/Jira.csv "Daniel Quan"
```

> 💡 The person filter searches across both **assignee** and **reporter** fields, so it captures defects the person was assigned to or reported.

---

## 📁 Output files

Reports are saved in the `./reports/` folder:

| File | Description |
|---|---|
| `report_FILENAME_DATE.json` | Full report with all defects |
| `summary_FILENAME_DATE.json` | Summary by status / priority / assignee |

When filtering by person, the name is included in the filename:
```
report_Jira_Jane_Doe_2026-05-06.json
```

### Report structure

```json
{
  "generated_at": "2026-05-06T...",
  "source_file": "Jira.csv",
  "filter_person": "Jane Doe",
  "total_processed": 12,
  "summary": {
    "byStatus":   { "Open": 5, "In Progress": 4, "Reopened": 3 },
    "byPriority": { "High": 4, "Medium": 6, "Low": 2 },
    "byAssignee": { "Jane Doe": 8, "Unassigned": 4 },
    "byReporter": { "John Smith": 7, "Alex Roe": 5 }
  },
  "defects": [
    {
      "key": "PROJ-123",
      "url": "https://your-company.atlassian.net/browse/PROJ-123",
      "summary": "Login fails on Safari",
      "type": "Bug",
      "status": "Open",
      "priority": "High",
      "assignee": "Jane Doe",
      "reporter": "John Smith",
      "created": {
        "iso": "2026-04-01T10:00:00.000Z",
        "readable": "April 1, 2026 at 10:00 AM"
      },
      "last_updated": {
        "iso": "2026-05-05T15:30:00.000Z",
        "readable": "May 5, 2026 at 03:30 PM"
      }
    }
  ]
}
```

---

## ⚠️ Common issues

| Error | Solution |
|---|---|
| `Cannot find module 'csv-parse/sync'` | Run `npm ci` inside `jira-defects-report/` |
| `File not found` | Check the path to your CSV file |
| `No defects found for "Name"` | Check the exact name spelling in your CSV |
| CSV has no bug rows | The script will process all rows if no Bug/Defect type is found |