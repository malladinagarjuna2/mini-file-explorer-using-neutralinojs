let currentPath = null;
let selectedItem = null;
let selectedItemType = null;
let currentFolderTarget = null;  // Holds {type, path, handle} for cross-platform FS access

// Video player state
const SUPPORTED_VIDEO_EXTENSIONS = ['mp4', 'avi', 'mkv', 'webm', 'mov', 'flv', 'm4v', 'wmv', '3gp', 'ogv'];

/**
 * Check if a file is a video file based on its extension
 */
function isVideoFile(fileName) {
    const ext = fileName.split('.').pop().toLowerCase();
    return SUPPORTED_VIDEO_EXTENSIONS.includes(ext);
}

/**
 * Find the first video file in the directory
 */
async function findVideoInDirectory(entries) {
    for (const entry of entries) {
        if (entry.type === 'FILE' && isVideoFile(entry.entry)) {
            return entry.entry;
        }
    }
    return null;
}

/**
 * Play a video file
 */
function playVideo(videoPath, videoFileName) {
    const modal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    const videoSource = document.getElementById('videoSource');
    const videoTitle = document.getElementById('videoTitle');
    const videoPathDisplay = document.getElementById('videoPath');
    
    // Set video source (Neutralino file path)
    videoSource.src = `file:///${videoPath.replace(/\\/g, '/')}`;
    videoPlayer.load();
    videoPlayer.play();
    
    // Update UI
    videoTitle.textContent = `Now Playing: ${videoFileName}`;
    videoPathDisplay.textContent = `📁 ${videoPath}`;
    
    modal.classList.add('active');
}

/**
 * Close video player
 */
function closeVideoPlayer() {
    const modal = document.getElementById('videoModal');
    const videoPlayer = document.getElementById('videoPlayer');
    
    videoPlayer.pause();
    videoPlayer.currentTime = 0;
    modal.classList.remove('active');
}

// Close video player button event
document.getElementById('closeVideoBtn').addEventListener('click', closeVideoPlayer);

// Close video player when clicking outside
document.getElementById('videoModal').addEventListener('click', (e) => {
    if (e.target.id === 'videoModal') {
        closeVideoPlayer();
    }
});

// Initialize Neutralino only when running inside the Neutralino native runtime.
// When serving from a normal browser (HTTP), NL_PORT / NL_TOKEN will be undefined
// and Neutralino.init() attempts a WebSocket connection to an invalid URL.
if (typeof Neutralino !== 'undefined' && (window.NL_PORT || window.NL_TOKEN || window.NL_CINJECTED || window.NL_GINJECTED)) {
    try {
        Neutralino.init();
    } catch (e) {
        console.warn('Neutralino.init() failed:', e);
    }
} else {
    // Running in a regular browser — Neutralino runtime not available.
    console.log('Neutralino runtime not detected; using browser fallback.');
}

// ============================================================================
// BROWSER FALLBACK: File System Access API helpers
// ============================================================================

let browserFolderHandle = null;

/**
 * Cross-platform folder picker.
 * - In Neutralino: uses Neutralino.os.showFolderDialog
 * - In browser: uses showDirectoryPicker (triggers permission prompt)
 */
async function selectFolder() {
    if (typeof Neutralino !== 'undefined' && (window.NL_PORT || window.NL_TOKEN)) {
        // Neutralino native app
        try {
            const selectedPath = await Neutralino.os.showFolderDialog('Select a folder', {
                defaultPath: 'C:\\Users'
            });
            return { type: 'neutralino', path: selectedPath };
        } catch (err) {
            console.error('Neutralino folder selection failed:', err);
            throw err;
        }
    } else if (window.showDirectoryPicker) {
        // Browser with File System Access API (will show permission prompt)
        try {
            const handle = await window.showDirectoryPicker();
            browserFolderHandle = handle;
            return { type: 'web', handle };
        } catch (err) {
            console.error('Browser folder selection failed:', err);
            throw err;
        }
    } else {
        throw new Error('No folder picker available (Neutralino or File System Access API)');
    }
}

/**
 * Read directory entries from either Neutralino or web handle.
 */
async function listDirectory(target) {
    if (target.type === 'neutralino') {
        return await Neutralino.filesystem.readDirectory(target.path);
    } else if (target.type === 'web' && target.handle) {
        const entries = [];
        try {
            for await (const [name, handle] of target.handle.entries()) {
                entries.push({
                    entry: name,
                    type: handle.kind === 'directory' ? 'DIRECTORY' : 'FILE'
                });
            }
        } catch (err) {
            console.error('Error listing web directory:', err);
        }
        return entries;
    }
    return [];
}

/**
 * Get file/directory stats.
 */
async function getItemStats(target, name) {
    if (target.type === 'neutralino') {
        const sep = target.path.includes('\\') ? '\\' : '/';
        const fullPath = target.path + sep + name;
        return await Neutralino.filesystem.getStats(fullPath);
    } else if (target.type === 'web' && target.handle) {
        try {
            const handle = await target.handle.getFileHandle(name);
            const file = await handle.getFile();
            return {
                isDirectory: false,
                size: file.size,
                modifiedAt: file.lastModified
            };
        } catch (err) {
            try {
                await target.handle.getDirectoryHandle(name);
                return { isDirectory: true, size: 0 };
            } catch {
                throw err;
            }
        }
    }
    return null;
}


function getPathSeparator(basePath) {
    return basePath && basePath.includes('\\') ? '\\' : '/';
}


async function deleteDirectoryRecursive(dirPath, separator) {
    try {
        const entries = await Neutralino.filesystem.readDirectory(dirPath);
        
    
        for (const entry of entries) {
    
            if(entry.entry === '.' || entry.entry === '..') continue;
            const fullPath = dirPath + separator + entry.entry;
            if (entry.type === 'DIRECTORY') {
           
                await deleteDirectoryRecursive(fullPath, separator);
            } else {
                
                await Neutralino.filesystem.remove(fullPath);
            }
        }
        
      
        await Neutralino.filesystem.remove(dirPath);
    } catch(err) {
        console.error("Error deleting directory:", dirPath, err);
        throw err;
    }
}

// FOLDER SELECTION WITH POLLING (see polling section below for actual implementation)

document.getElementById('readdirectory').addEventListener("click", async() => {
if(!currentPath || !currentFolderTarget){
     alert("Please select a folder first");
     return;
} 
try {
    const entries = await listDirectory(currentFolderTarget);
    console.log(entries);
    
 
    const fileList = document.getElementById('fileList');
    fileList.innerHTML = ''; 
    
    entries.forEach(entry => {
        const li = document.createElement('li');
        const icon = entry.type === 'DIRECTORY' ? '📁' : '📄';
        li.textContent = `${icon} ${entry.entry}`;
        li.setAttribute('data-name', entry.entry);
        li.setAttribute('data-type', entry.type);
        
       
        li.addEventListener('click', () => {
            document.querySelectorAll('#fileList li').forEach(item => item.classList.remove('selected'));
            li.classList.add('selected');
            selectedItem = entry.entry;
            selectedItemType = entry.type;
            document.getElementById('deleteFolderBtn').disabled = false;
        });
        
   
        li.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            document.querySelectorAll('#fileList li').forEach(item => item.classList.remove('selected'));
            li.classList.add('selected');
            selectedItem = entry.entry;
            selectedItemType = entry.type;
            document.getElementById('deleteFolderBtn').disabled = false;
            showContextMenu(e.clientX, e.clientY);
        });
        
        fileList.appendChild(li);
    });

}catch(err){
    console.log(err);
    alert('Failed to read directory: ' + (err.message || err));
}

});

async function showStats(fileName){
     const fullPath = currentPath+ "/" + fileName;
    const stats = await Neutralino.filesystem.getStats(fullPath);
console.log(stats);
 }



document.getElementById('getStats').addEventListener("click", async() => {
    if(!currentPath){
        alert("Please select a folder first");
        return;
    }
    try {
        const stats = await Neutralino.filesystem.getStats(currentPath);
        console.log(stats);
        alert(`Path: ${currentPath}\nType: ${stats.isDirectory ? 'Directory' : 'File'}\nSize: ${stats.size} bytes`);
    }
    catch(err){
        console.log(err);
    }
});


async function openFile(fileName){
  const fullPath= currentPath+ "/" + fileName;
  return await Neutralino.os.open(fullPath);
}


document.getElementById('createFolderBtn').addEventListener("click", async() => {
    if(!currentPath){
        alert("Please select a folder first");
        return;
    }
    
    try {
        const folderName = prompt("Enter folder name:");
        if(!folderName || folderName.trim() === '') return;
        
        const pathSeparator = currentPath.includes('\\') ? '\\' : '/';
        const folderPath = currentPath + pathSeparator + folderName.trim();
        
      
        try {
            await Neutralino.filesystem.getStats(folderPath);
            alert("Folder already exists!");
            return;
        } catch(err) {

        }
        
        await Neutralino.filesystem.createDirectory(folderPath);
        Neutralino.os.showNotification("Success", `Folder '${folderName}' created successfully`);
        
       
        document.getElementById('readdirectory').click();
    } catch(err) {
        console.error("Create folder error:", err);
        Neutralino.os.showNotification("Error", "Failed to create folder: " + err.message);
    }
});


document.getElementById('deleteFolderBtn').addEventListener("click", async() => {
    if(!currentPath){
        alert("Please select a folder first");
        return;
    }
    
    if(!selectedItem){
        alert("Please select an item to delete");
        return;
    }
    
    try {
        const pathSeparator = getPathSeparator(currentPath);
        const itemPath = currentPath + pathSeparator + selectedItem;
        const stats = await Neutralino.filesystem.getStats(itemPath);
        
        const isDir = stats.isDirectory;
        const confirmDelete = confirm(`Are you sure you want to delete the ${isDir ? 'folder' : 'file'} '${selectedItem}'? This action cannot be undone.`);
        if(!confirmDelete) return;
        
        if(isDir){
            await deleteDirectoryRecursive(itemPath, pathSeparator);
        } else {
            await Neutralino.filesystem.remove(itemPath);
        }
        
        Neutralino.os.showNotification("Success", `${isDir ? 'Folder' : 'File'} '${selectedItem}' deleted successfully`);
        selectedItem = null;
        selectedItemType = null;
        document.getElementById('deleteFolderBtn').disabled = true;
        document.querySelectorAll('#fileList li').forEach(item => item.classList.remove('selected'));
        
        document.getElementById('readdirectory').click();
    } catch(err) {
        console.error("Delete error (button):", err);
        alert("Failed to delete: " + (err && err.message ? err.message : err));
        Neutralino.os.showNotification("Error", "Failed to delete item: " + err.message);
    }
});


function showContextMenu(x, y) {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'block';
    contextMenu.style.left = x + 'px';
    contextMenu.style.top = y + 'px';
}

function hideContextMenu() {
    const contextMenu = document.getElementById('contextMenu');
    contextMenu.style.display = 'none';
}


document.getElementById('deleteItemBtn').addEventListener("click", async() => {
    if(!selectedItem) return;
    
    try {
        const pathSeparator = getPathSeparator(currentPath);
        const itemPath = currentPath + pathSeparator + selectedItem;
        const stats = await Neutralino.filesystem.getStats(itemPath);
        
        const confirmDelete = confirm(`Are you sure you want to delete '${selectedItem}'?`);
        if(!confirmDelete) {
            hideContextMenu();
            return;
        }
        
        if(stats.isDirectory){
            await deleteDirectoryRecursive(itemPath, pathSeparator);
        } else {
            await Neutralino.filesystem.remove(itemPath);
        }
        
        Neutralino.os.showNotification("Success", `'${selectedItem}' deleted successfully`);
        selectedItem = null;
        selectedItemType = null;
        document.getElementById('deleteFolderBtn').disabled = true;
        hideContextMenu();
        document.getElementById('readdirectory').click();
    } catch(err) {
        console.error("Delete error (context menu):", err);
        alert("Failed to delete: " + (err && err.message ? err.message : err));
        Neutralino.os.showNotification("Error", "Failed to delete item: " + err.message);
    }
});


document.getElementById('renameItemBtn').addEventListener("click", async() => {
    if(!selectedItem) return;
    
    try {
        const newName = prompt(`Rename '${selectedItem}' to:`, selectedItem);
        if(!newName || newName.trim() === '') {
            hideContextMenu();
            return;
        }
        
        const pathSeparator = currentPath.includes('\\') ? '\\' : '/';
        const oldPath = currentPath + pathSeparator + selectedItem;
        const newPath = currentPath + pathSeparator + newName.trim();
        
       
        try {
            await Neutralino.filesystem.getStats(newPath);
            alert("A file/folder with this name already exists!");
            hideContextMenu();
            return;
        } catch(err) {
           
        }
        
       
        const stats = await Neutralino.filesystem.getStats(oldPath);
        if(stats.isDirectory){
    
            alert("Folder renaming is not directly supported. Please use your file manager.");
        } else {
           
            const content = await Neutralino.filesystem.readFile(oldPath);
            await Neutralino.filesystem.writeFile(newPath, content);
            await Neutralino.filesystem.removeFile(oldPath);
            Neutralino.os.showNotification("Success", `'${selectedItem}' renamed to '${newName}'`);
        }
        
        selectedItem = null;
        hideContextMenu();
        document.getElementById('readdirectory').click();
    } catch(err) {
        console.error("Rename error:", err);
        Neutralino.os.showNotification("Error", "Failed to rename item: " + err.message);
    }
});


document.addEventListener('click', () => {
    hideContextMenu();
});



let previousSnapshot = null;
let pollingTimer = null;
const POLLING_INTERVAL = 3000;



async function takeSnapshot(folderTarget) {
    const snapshot = {};
    
    try {
        const entries = await listDirectory(folderTarget);
        
        for (const entry of entries) {
            if (entry.entry === '.' || entry.entry === '..') continue;
            
            try {
                const stats = await getItemStats(folderTarget, entry.entry);
                
                snapshot[entry.entry] = {
                    mtime: stats.modifiedAt || stats.createdAt || 0,
                    isDir: stats.isDirectory
                };
            } catch (err) {
                console.warn(`Could not get stats for: ${entry.entry}`, err);
            }
        }
    } catch (err) {
        console.error('Error taking snapshot:', err);
    }
    
    return snapshot;
}



function compareSnapshots(oldSnap, newSnap) {
    const added = [];
    const removed = [];
    const modified = [];
    
   
    for (const fileName in newSnap) {
        if (!oldSnap[fileName]) {
           
            added.push(fileName);
        } else if (oldSnap[fileName].mtime !== newSnap[fileName].mtime) {
          
            modified.push(fileName);
        }
    }
    
  
    for (const fileName in oldSnap) {
        if (!newSnap[fileName]) {
            removed.push(fileName);
        }
    }
    
    return { added, removed, modified };
}



async function reactToChanges(changes) {
    const { added, removed, modified } = changes;
    
    let message = '';
    
    if (added.length > 0) {
        const itemNames = added.join(', ');
        message += ` ADDED (${added.length}):\n${itemNames}\n\n`;
    }
    
    if (removed.length > 0) {
        const itemNames = removed.join(', ');
        message += ` REMOVED (${removed.length}):\n${itemNames}\n\n`;
    }
    
    if (modified.length > 0) {
        const itemNames = modified.join(', ');
        message += ` MODIFIED (${modified.length}):\n${itemNames}\n\n`;
    }
    
    if (message) {
        alert(' FILE CHANGES DETECTED!\n\n' + message);
    }
    
 
    document.getElementById('readdirectory').click();
}


async function startPolling(folderTarget) {
   
    stopPolling();
    
    if (!folderTarget) {
        console.warn('Cannot start polling: no folder target provided');
        return;
    }
    
    console.log(`Starting polling for:`, folderTarget);
    

    document.getElementById('pollingIndicator').style.display = 'inline-flex';
    

    previousSnapshot = await takeSnapshot(folderTarget);
    
   
    pollingTimer = setInterval(async () => {
        try {
  
            const newSnapshot = await takeSnapshot(folderTarget);
            
            const changes = compareSnapshots(previousSnapshot, newSnapshot);
            
      
            const hasChanges = 
                changes.added.length > 0 || 
                changes.removed.length > 0 || 
                changes.modified.length > 0;
            
            if (hasChanges) {
                console.log('Changes detected:', changes);
                reactToChanges(changes);
            }
            
       
            previousSnapshot = newSnapshot;
            
        } catch (err) {
            console.error('Error during polling:', err);
        }
    }, POLLING_INTERVAL);
}



function stopPolling() {
    if (pollingTimer) {
        clearInterval(pollingTimer);
        pollingTimer = null;
        previousSnapshot = null;
        
    
        document.getElementById('pollingIndicator').style.display = 'none';
        
        console.log('Polling stopped');
    }
}


document.getElementById('selectFolderBtn').addEventListener("click", async() => {
    try {
        const folderTarget = await selectFolder();
        console.log('Selected folder:', folderTarget);
        
        stopPolling();
        
        // Store the target for later use in reads/writes
        currentFolderTarget = folderTarget;
        
        // Display path (for Neutralino) or "Web Directory" (for web)
        if (folderTarget.type === 'neutralino') {
            currentPath = folderTarget.path;
            document.getElementById("folderPath").innerText = folderTarget.path;
        } else {
            currentPath = '[Web Directory]';
            document.getElementById("folderPath").innerText = `[Web Directory: ${folderTarget.handle.name}]`;
        }
        
        // Refresh the directory listing
        document.getElementById('readdirectory').click();
        
        // Start polling for changes
        startPolling(folderTarget);
        
        // Auto-play video if found
        await autoPlayVideoIfFound();
        
    } catch (err) {
        console.error('Folder selection error:', err);
        alert('Failed to select folder: ' + (err.message || err));
    }
});

/**
 * Auto-play the first video found in the selected folder
 */
async function autoPlayVideoIfFound() {
    if (!currentFolderTarget || !currentPath) return;
    
    try {
        const entries = await listDirectory(currentFolderTarget);
        const videoFileName = await findVideoInDirectory(entries);
        
        if (videoFileName) {
            const pathSeparator = getPathSeparator(currentPath);
            const videoPath = currentPath + pathSeparator + videoFileName;
            console.log('Auto-playing video:', videoFileName);
            playVideo(videoPath, videoFileName);
        }
    } catch (err) {
        console.error('Error checking for videos:', err);
    }
}




Neutralino.events.on("windowClose", () => {
    stopPolling();
    Neutralino.app.exit();
});
