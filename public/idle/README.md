# Idle side panel photos

After 30 seconds with no touch, click, or key, SynFleet hides the top bar. Miners stay on the left. Your photos play on the right.

Drop image files in this folder (`public/idle/`). The app reads the folder itself. There is no settings screen for the pictures.

## File names

| Rule | Detail |
| --- | --- |
| Folder | `public/idle/` only. Do not put pictures in subfolders. |
| Types | `.jpg` `.jpeg` `.png` `.webp` `.gif` |
| Name | A plain file name, such as `01.jpg` or `rack-night.png`. No folders in the name. Do not start the name with a dot. |
| Order | Alphabetical. `01.jpg` plays before `02.jpg`. Use two digits (`01`, `02`, … `14`) so `10` does not sort before `2`. |
| Hidden files | Names that start with `.` are skipped. |
| Sample set | `01.jpg` through `14.jpg` ship with the app. Replace them or add more. Delete a file to remove it from the show. |

Each picture stays up for 8 seconds, then the next name in alphabetical order. At the end it starts again.

## After you add pictures

On a Raspberry Pi that is already running the service, copy the new files into both places, then restart:

```sh
sudo cp 01.jpg 02.jpg /opt/synfleet/public/idle/
sudo mkdir -p /opt/synfleet/.output/public/idle
sudo cp 01.jpg 02.jpg /opt/synfleet/.output/public/idle/
sudo systemctl restart synfleet
```

The running server serves files from `.output/public/idle`. The installer copies `public/idle` into that folder on the next `./pi/install.sh` as well.

On Windows, put the files in `public\idle`, run `windows\install.ps1` again so the build picks them up, then start with `windows\start.bat`.

In dev mode (`npm run dev`), saving a file into `public/idle` and refreshing the page is enough.
