class Pattern {
	constructor(name) {
		this.name = name;
		this.tempo = 0;
		this.groovesMode = 'sequence';
		this.fillsMode = 'sequence';
		this.grooves = [];
		this.fills = [];
	};	
	
	toTrack(data) {		
		var midi = MidiParser.parse(data);
		var midiTrack = midi.formatType == 0 ? midi.track[0] : midi.track[1];

		var track = {
			"ppqn": midi.timeDivision,
			"events": JSON.parse(JSON.stringify(midiTrack.event))
		};
		
		return track;
	}

	createGroove(type, name, data) {
		this.grooves.push({
			"type": type,
			"name": name,
			"data": data,
			"track": this.toTrack(data)
		});
	}

	createFill(type, name, data) {
		this.fills.push({
			"type": type,
			"name": name,
			"data": data,
			"track": this.toTrack(data)
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
		
		this.onEndOfPattern = this.onEndOfPattern.bind(this);
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
			this.play();
		} else {
			if (this.playingPattern == pattern.name) {
				// User requested to play the same pattern as the one currently playing.				
				// Clear next pattern, if any.
				this.nextPattern = null;
			} else {
				this.nextPattern = pattern.name;
				// TODO: mark need for fill!
			}
		}
	}
			
	play() {
		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}
		
		console.log('Play pattern => ' + this.playingPattern);
		var pattern = this.song.patterns[this.playingPattern];
		var groove = pattern.grooves[0]; // TODO: Honor groove selection mode (sequence/random)
		var tempo = pattern.tempo > 0 ? pattern.tempo : parseInt($('#songTempo').val());
		
		var f = 60000 / groove.track.ppqn / tempo;
		var startTime = performance.now();
		var time = startTime;
		for (var i=0;i<groove.track.events.length;i++) {
			var event = groove.track.events[i];
			if (event.type == 8 || event.type == 9) { 
				time += (event.deltaTime * f);
				activeMidiOut.send([event.type == 8 ? 0x80 : 0x90, event.data[0], event.data[1]], time);
			}			
		}
		this.patternsEnds = time;
		setTimeout(this.onEndOfPattern, time - startTime);
	}
	
	onEndOfPattern() {
		if (this.nextPattern) {
			console.log('To next pattern => ' + this.nextPattern);
			
			this.playingPattern = this.nextPattern;
			this.nextPattern = null;
		} else if (this.playingPattern) {
			console.log('Repeat pattern => ' + this.playingPattern);
		}
		
		if (this.playingPattern)
			this.play();		
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

		const lastMidiIn = window.localStorage.getItem('midiIn');
		const lastMidiOut = window.localStorage.getItem('midiOut');

		Array.from(inputs).forEach(i => {
			var sel = document.getElementById('midiIns');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(i.name));
			opt.value = i.id; 
			if (i.id == lastMidiIn)
				opt.selected = 'selected';
			sel.appendChild(opt);
		});

		Array.from(outputs).forEach(o => {
			var sel = document.getElementById('midiOuts');
			var opt = document.createElement('option');
			opt.appendChild(document.createTextNode(o.name));
			opt.value = o.id; 
			if (o.id == lastMidiOut)
				opt.selected = 'selected';
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
		window.localStorage.setItem('midiIn', activeMidiIn.id);
	}
}

function switchMidiOut() {
	if (activeMidiOut) {
		activeMidiOut = null;
	}
	
	var portID = $('#midiOuts').val();
	if (portID) {
		activeMidiOut = window.ma.outputs.get(portID);
		window.localStorage.setItem('midiOut', activeMidiOut.id);
	}
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
			case 90:
				onPedal(1);
				return
			case 88:
				onPedal(2);
				return
			case 67:
				onPedal(3);
				return
			case 86:
				onPedal(4);
				return
			case 66:
				onPedal(5);
				return
		}	
	});
}
