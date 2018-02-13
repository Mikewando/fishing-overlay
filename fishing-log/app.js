const fs = require('fs');
const path = require('path');
const readline = require('readline');
const argv = require('minimist')(process.argv.slice(2));

const logFilePath = argv._[0];
if (!logFilePath) {
    console.error("No log file specified!");
    process.exit(1);
}

console.log("Reading", path.basename(logFilePath));

const rl = readline.createInterface({
    input: fs.createReadStream(logFilePath),
    crlfDelay: Infinity
});

var context = {};
rl.on('line', (line) => {
    let channel, timestamp, unknown, sender, message, rest;
    [channel, timestamp, unknown, sender, message, ...rest] = line.split('|');

    // Fishing message seem to only appear on channel 0
    if (channel != 0 || !message) {
        return;
    }

    if (message.startsWith("You apply")) {
        const baitApplication = parseMessage(message);
        let bait;
        [bait] = baitApplication.items;
        context.bait = bait.name;
    } else if (message.startsWith("The fishing hole at")) {
        const match = /The fishing hole at (.*) is added to your fishing log./.exec(message);
        context.fishingHole = match[1];
    } else if (message.startsWith("You cast your line at")) {
        const match = /You cast your line at (.*)\./.exec(message);
        context.castTimestamp = new Date(timestamp);
        context.fishingHole = match[1];
    } else if (/(^Something bites)|(^The fish gets away)|(^Nothing bites)|(^You lose your)|(^You reel in your)/.exec(message)) {
        context.hookTimestamp = new Date(timestamp);
    } else if (message.startsWith("You land a")) {
        const fishingResult = parseMessage(message);
        if (!fishingResult.items.length) {
            // e.g. "You land a fish usable with Mooch II"
            return;
        }
        let fish;
        [fish] = fishingResult.items;
        const size = /measuring (\d+\.\d)/.exec(fishingResult.printableText);
        if (size) {
            fish.fishSize = +size[1];
        }
        context.timeToHook = (context.hookTimestamp - context.castTimestamp) / 1000;
        Object.assign(fish, context);
        if (fish.name == 'diao squid') {
            process.exit(0);
        }
        console.log(fish);
    }
});

function parseMessage(message) {
    let result = {
        printableText: '',
        items: [],
        metaBlocks: []
    };
    let STATE = 'TEXT';
    let metaBlock, item;
    for (let char of message) {
        const point = char.charCodeAt(0);
        //console.debug("----");
        //console.debug(STATE);
        //console.debug(point.toString(16));
        if (STATE === 'TEXT' || STATE === 'ITEM_NAME') {
            if (point == 2) {
                STATE = 'META_BLOCK_START';
                if (item) {
                    item.name = item.name.trim();
                    result.items.push(item);
                    item = undefined;
                }
                metaBlock = {
                    data: ""
                };
            } else if (point == 0xE03D) { // Icon for collectible
                if (item) {
                    item.collectible = true; 
                }
                result.printableText += '(Collect)';
            } else if (point == 0xE03C) { // Icon for HQ item
                if (item) {
                    item.hq = true; 
                }
                result.printableText += '(HQ)';
            } else if (point == 0xE0BB) { // Icon for link
                // Print nothing
            } else {
                result.printableText += char;
                if (STATE === 'ITEM_NAME') {
                    item.name += char;
                }
            }
        } else if (STATE === 'META_BLOCK_START') {
            STATE = 'META_BLOCK_LENGTH';
            metaBlock.op = point;
        } else if (STATE === 'META_BLOCK_LENGTH') {
            STATE = 'META_BLOCK_DATA';
            metaBlock.remaining = point;
        } else if (STATE === 'META_BLOCK_DATA') {
            if (--metaBlock.remaining > 0) {
                metaBlock.data += char;
                // XXX When I fish collectible daio squid one of the metablocks seems to be one character short.
                //     It feels unlikely that the game is causing this error, but not sure what to do about it.
                if (metaBlock.remaining == 1 && point == 3) {
                    metaBlock.remaining--;
                } else {
                    continue;
                }
            }

            if (point != 3) {
                console.warn("Didn't parse message correctly", message);
            }

            result.metaBlocks.push(metaBlock);
            // XXX doesn't scale to multiple items...
            if (result.metaBlocks.length == 4) {
                // Item name seems to appear after fourth block
                STATE = 'ITEM_NAME';
                item = {
                    name: "",
                    hq: false,
                    collectible: false
                };
            } else {
                STATE = 'TEXT';
            }
        }
    }
    return result;
}