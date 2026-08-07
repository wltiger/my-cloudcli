# 同步官方源码操作指南

把 `siteboon/claudecodeui`（`upstream`）拉取合并进本 fork（`wltiger/my-cloudcli`，`origin`）的具体步骤。跟 `docs/fork-customizations.md` 配套——那份文件记录"哪里不一样、为什么不一样"，这份文件记录"具体怎么操作"。

远端/分支的完整配置（`main` 镜像 `upstream/main`，所有 fork 工作都在 `dev` 分支上）在 `docs/agents/issue-tracker.md` 里有完整记录，这里默认那套配置已经搭好。

## 开始之前

- `dev` 分支 `git status` 是干净的——手头有没提交的改动先 commit 或者 stash。
- 确认 `git config rerere.enabled` 是 `true`（不是的话跑 `git config rerere.enabled true`）——它会自动重放这个仓库之前已经解决过的冲突，同一批自定义文件反复冲突只会越来越省事，不会越来越麻烦。

## 操作步骤

1. **更新干净镜像分支。**
   ```
   git checkout main
   git pull upstream main
   ```
   `main` 应该能干净地 fast-forward——它上面从来不放本地提交。如果不能 fast-forward，说明有东西误提交到了 `main` 上，先处理这个问题（正常使用下不应该出现）。

2. **合并进工作分支。**
   ```
   git checkout dev
   git merge main
   ```
   用真正的 merge，不要用 rebase——`dev` 已经 push 到 `origin` 上了，每次同步都 rebase 意味着每次都要强推、重写共享历史，这里没有实际收益。用 merge 还能留下"每次官方更新具体是什么时候合进来的"这个诚实的记录。

3. **逐个文件解决冲突。** 每个冲突文件：
   - 先查 `docs/fork-customizations.md`——这个文件是不是在里面某一条编号的自定义清单里？
     - **是** → 照那一条的"同步官方时怎么办"来处理。大部分条目都是"保留我的，在官方新代码外面重新套一遍条件判断/包装"。有几条（目前是第5、6条）明确写了要重新评估、不要无脑保留——处理这几条之前先读一下链接的 ADR，或者重新过一遍当时的推理。
   - **否** → 这是一个目前没被记录在自定义清单里的意外冲突。先按自己的判断解决掉，然后想一下：这只是一次偶然的、无关紧要的碰撞（不用记），还是暴露了一个真实的、会长期存在的分歧（应该补进 `fork-customizations.md`）？如果是后者就补一条。
   - `git rerere` 会自动把之前见过的、一模一样的解决方案重新贴上去——用 `git diff --staged` 看一眼它做了什么，不要盲目信任，尤其是如果官方那边这次改动幅度比上次大很多的话。

4. **验证。**
   ```
   npm install        # 万一依赖变了
   npm run typecheck
   npm run lint
   npm test
   ```
   然后拿浏览器手动过一遍（固定测试账号的用法见 `.claude/CLAUDE.md` 的"Local UI testing"那节）——至少把 `docs/fork-customizations.md` 里列的几个功能点都重新点一遍，因为一次糟糕的冲突解决，最容易在这几个地方悄悄留下回归问题。

5. **提交并推送。**
   ```
   git commit          # 只有合并本身需要解决冲突才用提交
   git push origin dev
   ```

## 同步完之后：回头看一遍 fork-customizations.md

有几条自定义之所以存在，就是因为当时官方**还没解决**那个问题（离线缓存、命名不统一等等）。每次同步完，把清单过一遍：官方是不是刚好上了什么功能，让某条自定义整个变得多余了？如果是，就把那条自定义的代码和清单条目一起删掉，不要背着一个已经没用的分歧继续走下去。如果某条的原因变了但自定义本身还需要保留，就把它的"为什么"/"同步时怎么办"文字更新一下，不要留着过时的说法。
