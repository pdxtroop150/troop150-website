## How to develop changes

We use the [fork and pull model](https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/getting-started/about-collaborative-development-models#fork-and-pull-model) so each team member can develop their changes independently. The general gist of this form of collaboration is:

1. A team member creates their own copy of the entire website source code (this is called "forking" or "cloning" the source repository).
1. The team member makes changes to the sources, then requests a review from other team members (this is called a "pull request").
1. Once other team members approve the changes the original team member can "merge" the changes in.
1. All other team members can "pull" down the latest changes that have been merged at any time into their own "fork" or "clone" of the repository.

### First time instructions

If you haven't worked on the website before you first need to fork the sources to create your own personal copy.

1. Sign up and/or sign in to [github.com](https://github.com).
1. Navigate to the main source repository for the website: pdxtroop150/troop150-website.
1. Click the "Fork" button at the top right.
1. Choose your personal account as the owner, and leave the name as "troop150-website".
1. Click the green "Create fork" button.
1. Wait for your repository to finish forking, which should take just a second or two. You can refresh your browser if needed to check.
1. Bookmark the URL for your fork so you can return to it in the future when you want to make changes. See below for details on how to make changes.

### Open a GitHub Codespace
1. Open a GitHub Codespace IDE if you don't have one open yet:
    1. Navigate to your fork of the repository.
    1. Click the green "Code" button, then the "Codespaces" tab.
        1. If you already have a Codespace, click it to re-open it.
        1. If not, create a new Codespace on the main branch.
    1. Wait for the Codespace to initialize. It will take roughly 30 seconds to do so.
1. Click on the "Source Control" tab in the sidebar on the left
1. Set up a "Remote" for the main pdxtroop150 repository if you have not done so already:
    1. Click the three dots at the top of the "Source Control" pane on the left and select "Remote" -> "Add Remote...".
    1. Choose "Add remote from GitHub".
    1. Type and select "pdxtoop150/troop150-website".
    1. Enter "upstream" for the remote name.

### For each new change you want to make
1. Create a new branch for your changes:
    1. Click the three dots at the top of the "Source Control" pane on the left and select "Branch" -> "Create Branch From..."
    1. Select "upstream/main"
    1. Create a short descriptive name for your changes (e.g. "fix-header-size")
1. Make changes to the sources
1. Review changes in the "Source Control" pane on the left, adding changes you are happy with to stage them for a commit. Then commit the changes to your branch, adding a short descriptive message of your changes.
1. Repeat making and committing changes as you like.
1. Click the "Create Pull Request" button at the top of the "Source Control" pane on the left to push your branch to your fork and create a pull request.
1. Have a team member review your pull request
1. Make any changes as requested
1. Once the team member has approved your pull request you can merge it in!

## How to complete specific tasks

### How to update favicon

Favicons are the little icon next to the title of the page

1. First download a png of the favicon you want
2. Open the public folder and right click the images folder inside
3. There should be an option that says Upload...
4. Click that and upload your file
5. Delete the old favicon file and rename your new one to "favicon.png"

### How to make a new page

1. Go to the menu.json file 
2. add this to the end of the main area
    ```json
        {
          "name": "Your Page",
          "url": "/your-page"
        }
    ```
3. Make sure the url ending has no capitals and uses hyphens in place of spaces
4. In the content folder there should be a folder called pages
5. In the pages folder create a new .md file with the same name form as the url above (e.g. `your-page.md`) and make sure it this at the top
    ```
    ---
    title: "Your Page title"
    description: "your page's description"
    draft: false
    ---
    ```
6. Then add all your text underneath