// The module path is the post-cutover path, not the current directory name.
// This directory is backend-v2/ until S8 renames it to backend/ (issue #94);
// declaring the final path now means that rename touches zero import lines.
module github.com/Skill-issue-coding/OrdioArena/backend

go 1.27

require (
	github.com/go-chi/chi/v5 v5.3.2
	github.com/joho/godotenv v1.5.1
)
