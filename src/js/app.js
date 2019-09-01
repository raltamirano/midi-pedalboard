class Pattern {
	constructor(name) {
		this.name = name;
		this.tempo = 0;
		this.groovesMode = 'sequence';
		this.fillsMode = 'sequence';
		this.grooves = [];
		this.fills = [];
	};	
	
	createGroove(type, name, data) {
		this.grooves.push({
			"type": type,
			"name": name,
			"data": data
		});
	}

	createFill(type, name, data) {
		this.fills.push({
			"type": type,
			"name": name,
			"data": data
		});
	}
}

class Song {
	constructor() {
		this.title = "Untitled";
		this.tempo = 120;
		this.patterns = {};
		this.actions = {}
	};
	
	createPattern() {
		var currentPatterns = Object.keys(this.patterns);
		for(var i=currentPatterns.length; i<100; i++) {
			var newPatternName = "Pattern " + (i+1);
			if (!(newPatternName in this.patterns)) {
				var newPattern = new Pattern(newPatternName);
				this.patterns[newPatternName] = newPattern; 
				return;
			}
		}
	}
}

class Orchestrator {
	constructor(song) {
		this.song = song;
		this.playingPattern = null;
		this.nextPattern = null;
		
		this.processMIDIEvent = this.processMIDIEvent.bind(this);
		this.onEndOfPattern = this.onEndOfPattern.bind(this);
		this.onEndOfPattern2 = this.onEndOfPattern2.bind(this);
		
		this.grooveParser = new MidiPlayer.Player(this.processMIDIEvent);
		this.fillParser = new MidiPlayer.Player(this.processMIDIEvent);
		
		this.grooveParser.on('endOfFile', this.onEndOfPattern);
		this.fillParser.on('endOfFile', this.onEndOfPattern);	
	}	
	
	isPlaying() {
		return this.playingPattern != null;
	}
	
	playNext(patternName) {
		var pattern = this.song.patterns[patternName];
		if (!pattern || pattern.grooves.length == 0)
			return;			
		
		if(!this.playingPattern) {
			// No pattern is currently playing, so let's play the requested one.
			this.playingPattern = pattern.name;
			this.loadPattern(this.playingPattern);
			this.playMIDI(false);
		} else {
			if (this.playingPattern.name == pattern.name) {
				// User requested to play the same pattern as the one currently playing.				
				// Clear next pattern, if any.
				this.nextPattern = null;
			} else {
				this.nextPattern = pattern.name;
				// TODO: mark need for fill!
			}
		}
	}
		
	prepareMIDI(midiData, tempo, isFill) {
		var parser = isFill ? this.grooveParser : this.fillParser;
		parser.loadDataUri(midiData);
		parser.resetTracks();
		parser.setTempo(tempo);
	}
	
	playMIDI(isFill) {
		console.log('Play MIDI. Pattern => ' + this.playingPattern + ' // isFill => ' + isFill);

		var parser = isFill ? this.grooveParser : this.fillParser;
		parser.resetTracks();
		parser.play();
	}
	
	processMIDIEvent(event) {
		console.log('Playing => ' + JSON.stringify(event));

		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}
		
		var eventType = null;
		if (event.name == 'Note on') 
			eventType = 0x90;
		else if (event.name == 'Note off') 
			eventType = 0x80;
		
		if (eventType)
			activeMidiOut.send([eventType, event.noteNumber, event.velocity]);
	}
	
	onEndOfPattern() {		
		console.log('Finished pattern => ' + this.playingPattern);
		setTimeout(this.onEndOfPattern2, 10);
	}
	
	onEndOfPattern2() {
		if (this.nextPattern) {
			console.log('To next pattern => ' + this.nextPattern);
			
			this.playingPattern = this.nextPattern;
			this.nextPattern = null;
			this.loadPattern(this.playingPattern);
		} else if (this.playingPattern) {
			console.log('Repeat pattern => ' + this.playingPattern);
		}
		
		if (this.playingPattern)
			this.playMIDI(false);		
	}
	
	loadPattern(patternName) {
		var pattern = this.song.patterns[patternName];
		var midiData = pattern.grooves[0].data; // TODO: Honor sequence/random config
		var tempo = pattern && pattern.tempo > 0 ? pattern.tempo : this.song.tempo;
		this.prepareMIDI(midiData, tempo, false);		
	}
}


var activeMidiIn = null;
var activeMidiOut = null;
var song = new Song();
var orchestrator = new Orchestrator(song);

$(document).ready(function() {
	editMode();
	midiSetup();
	enableTestKeys();	
	loadSong();
});

function midiSetup() {
	navigator.requestMIDIAccess().then(function(access) {
		window.ma = access;

		const inputs = access.inputs.values();
		const outputs = access.outputs.values();

		Array.from(inputs).forEach(i => {
			var sel = document.getElementById('midiIns');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(i.name));
			opt.value = i.id; 
			sel.appendChild(opt);
		});

		Array.from(outputs).forEach(o => {
			var sel = document.getElementById('midiOuts');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(o.name));
			opt.value = o.id; 
			sel.appendChild(opt);	 
		});

		access.onstatechange = function(e) {
			console.log(e.port.name, e.port.manufacturer, e.port.state);
		};
		
		switchMidiIn();
		switchMidiOut();
	});
}	


function loadSong() {
	orchestrator = new Orchestrator(song);
	console.log(JSON.stringify(song, null, 2));
	
	$('#songTitle').val(song.title);
	$('#songTempo').val(song.tempo);

	var patterns = $('#editingPattern');
	var patternGrooves = $('#editPatternGrooves');
	var patternFills = $('#editPatternFills');
	
	var savedPatternName = $("#editingPattern").val();
	
	patterns.empty();
	patternGrooves.empty();
	patternFills.empty();
	
	for (patternName in song.patterns) {
		var pattern = song.patterns[patternName];
		patterns.append($("<option />").val(pattern.name).text(pattern.name));
	}
	
	// TODO: Load actions
	
	if (savedPatternName && savedPatternName in song.patterns)
		patterns.val(savedPatternName);
	
	onSongPatternChange();
}

function onSongPatternChange() {
	var patternGrooves = $('#editPatternGrooves');
	var patternFills = $('#editPatternFills');
	
	patternGrooves.empty();
	patternFills.empty();
	
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;

	var pattern = song.patterns[editingPatternName];

	for(var i=0; i<pattern.grooves.length; i++) {
		var groove = pattern.grooves[i];
		patternGrooves.append($("<option />").val(i).text(groove.name));		
	}

	for(var i=0; i<pattern.fills.length; i++) {
		var fill = pattern.fills[i];
		patternFills.append($("<option />").val(i).text(fill.name));		
	}
}

function switchMidiIn() {
	if (activeMidiIn) {
		activeMidiIn.close();
		activeMidiIn = null;
	}
	
	var portID = $('#midiIns').val();
	if (portID) {
		activeMidiIn = window.ma.inputs.get(portID);
		activeMidiIn.onmidimessage = onMidiMessage;
		activeMidiIn.open();
	}
}

function switchMidiOut() {
	if (activeMidiOut) {
		activeMidiOut = null;
	}
	
	var portID = $('#midiOuts').val();
	if (portID)
		activeMidiOut = window.ma.outputs.get(portID);
}

function onSongAttributeChange(name, value) {
	if (name == 'title') {
		if (song.title != value)
			song.title = value;
	} else if (name == 'tempo') {
		var newTempo = parseInt(value);
		if (newTempo > 0 && newTempo < 10000 && song.tempo != newTempo)
			song.tempo = newTempo;
	}
}

function onMidiMessage(message) {
	//var midiMessage = parseMidiMessage(message)
	//if (midiMessage.velocity > 0) 
	//	onPedal(midiMessage.note-59);
}
  
function onPedal(pedal) {
	var patternName = Object.keys(song.patterns)[pedal - 1];
	orchestrator.playNext(patternName);
}
  
function playNote(note) {
	var noteOnMessage  = [0x90, note, 127]; 
	var noteOffMessage = [0x80, note, 127]; 
	activeMidiOut.send(noteOnMessage);  
	setTimeout(() => activeMidiOut.send(noteOffMessage), 500)
}
  
function parseMidiMessage(message) {
	return {
		command: message.data[0] >> 4,
		channel: message.data[0] & 0xf,
		note: message.data[1],
		velocity: message.data[2] / 127
	}
}

function loadSampleSong() {
	$.getJSON("etc/samples/song1.json", function(data) {
		song = data;
		loadSong();
	});
}

function editMode() {
	$('#editPanel').show();
	$('#playPanel').hide();
}

function playMode() {
	$('#editPanel').hide();
	$('#playPanel').show();
}
			
function createPattern() {
	song.createPattern();
	loadSong();
}

function createPatternGroove() {
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;
	
	var inputFile = $('#openFile');
	var fn = function(e) {
		inputFile.off('change');

		var file = inputFile[0].files[0];

		if (file) {
			var reader = new FileReader();
			reader.onloadend = function () {
				song.patterns[editingPatternName].createGroove('embedded', file.name, reader.result);
				loadSong();
			};

			reader.readAsDataURL(file);	
		}
	};
	
	inputFile.change(fn);
	inputFile.click();
}


function createPatternFill() {
	var editingPatternName = $("#editingPattern").val();
	if (!editingPatternName)
		return;
	
	var inputFile = $('#openFile');
	var fn = function(e) {
		inputFile.off('change');

		var file = inputFile[0].files[0];

		if (file) {
			var reader = new FileReader();
			reader.onloadend = function () {
				song.patterns[editingPatternName].createFill('embedded', file.name, reader.result);
				loadSong();
			};

			reader.readAsDataURL(file);	
		}
	};
	
	inputFile.change(fn);
	inputFile.click();
}


function enableTestKeys() {
	$(document).keydown(function(e) { 
		console.log(e.keyCode);
		
		switch(e.keyCode) {
			case 81: 
				playNote('36');
				return 
			case 87: 
				playNote('38');
				return
			case 80: 
				playNote('46');
				return
			case 79: 
				playNote('51');
				return
		}	
	});
}
