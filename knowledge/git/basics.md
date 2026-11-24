# Git Reference Guide
--- 

A Practical and Complete Guide to Version Control

Git is a distributed version control system used to track changes in source code, coordinate collaboration, and maintain a reliable history of a software project. It is a fundamental tool in modern software development, both in academic and professional environments.

Git allows developers to work independently, experiment safely, and merge work in a controlled and traceable way.

---
## Initial configuration

Before using Git, the developer identity should be configured:
```bash
git config --global user.name "Your Name"
git config --global user.email "youremail@example.com"
```

Configuration can be reviewed with:
```bash
git config --list
```

--- 
## Creating/Cloning

A new repository can be created in an existing project directory using:
```bash
git init
```

To download an existing project from a remote server:
```bash
git clone <repository-url>
```

---
## Changes review

The current state of a repository can be inspected at any time:
```bash
git status
```

To view the history of changes:
```bash
git log
git log --oneline
git log --oneline --graph --decorate --all
```

Differences between versions can be inspected using:
```bash
git diff
git diff --staged
```

---
## Commits

Files are added to the staging area before committing:
```bash
git add <file>
git add .
```

Changes are permanently recorded using commits:
```bash
git commit -m "Descriptive commit message"
```

The most recent commit can be modified:
```bash
git commit --amend
git commit --amend --no-edit
```

---
## Removing and restoring

Files can be removed from the repository:
```bash
git rm <file>
git rm --cached <file>
```

Files can also be restored to their last committed state(This have to be made before the commit):
```bash
git restore <file>
git restore --staged <file>
```

---
## Remote repository

Git supports collaboration through remote repositories. The default remote name is usually `origin`.
Remote repositories can be inspected and managed:
```bash
git remote -v
git remote add origin <repository-url>
git remote rename origin upstream
git remote remove origin
```

---
## Getting changes from remote repository
Changes from remote repositories can be retrieved without modifying the local branch:

```bash
git fetch
git fetch origin
git fetch --prune
git fetch --tags
git fetch --prune --tags
git fetch --all --prune
```

To retrieve and immediately integrate changes:
```bash
git pull
git pull origin main
git pull --rebase
```

Local commits are shared with others using:
```bash
git push
git push origin main
git push -u origin <branch-name>
git push origin --tags
```

---
## Branches

Git allows parallel development through branches. Branches represent independent lines of development.
### Branches can be listed, created, renamed, switched, and deleted:
```bash
git branch
git branch <branch-name>
git switch <branch-name>
git switch -c <new-branch>
git checkout <branch-name>
git checkout -b <new-branch>
git branch -m <new-name>
git branch -d <branch-name>
git branch -D <branch-name>
```

### Changes from one branch can be integrated into another:
```bash
git merge <branch-name>
```

### If necessary, a merge can be canceled:
```bash
git merge --abort
```

### Git also supports rebasing, which rewrites commit history to create a linear timeline:
```bash
git rebase main
git rebase -i HEAD~5
git rebase --abort
git rebase --continue
```

---
## Reset & revert

Mistakes can be corrected using reset or revert.
Reset moves the repository state to a previous commit:
```bash
git reset --soft HEAD~1
git reset --mixed HEAD~1
git reset --hard HEAD~1
```

Revert safely undoes changes by creating a new commit:
```bash
git revert <commit-hash>
```

Temporary work can be stored using stash:
```bash
git stash
git stash push -m "Work in progress"
git stash list
git stash pop
git stash apply
git stash drop
git stash clear
```

---

Specific commits can be applied from other branches:
```bash
git cherry-pick <commit-hash>
git cherry-pick <hash1> <hash2>
```

---

Git allows marking important versions using tags:
```bash
git tag v1.0.0
git tag -a v1.0.0 -m "Release v1.0.0"
git tag
git show v1.0.0
git push origin --tags
```
Repositories can be inspected and searched:
```bash
git blame <file>
git grep "search-text"
git log --grep="keyword"
git log -- <file>
git diff main..feature-branch
```

---

Git records all movements of HEAD using reflog, which allows recovery of lost commits:
```bash
git reflog
git reset --hard <reflog-hash>
```

---

Repository maintenance commands include:
```bash
git fetch --prune
git gc
git fsck
```

---

Common options used across commands:

- `--dry-run`
- `--verbose`
- `--all`
- `--force`
- `--force-with-lease`

Examples:
```bash
git push --dry-run
git push --force-with-lease
```

---

All Git commands follow the general syntax:
```bash
git <command> [options] [arguments]
```

---

Git is not only a tool but a discipline. Mastering its commands enables developers to work with confidence, recover from mistakes, collaborate effectively, and maintain clean and understandable project histories.