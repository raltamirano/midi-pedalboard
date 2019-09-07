class Pattern {
	constructor(name) {
		this.name = name;
		this.tempo = 0;
		this.groovesMode = 'sequence';
		this.fillsMode = 'sequence';
		this.grooves = [];
		this.fills = [];
	};	
	
	getLengthTicks(events) {
		var totalTicks = 0;
		for (var i=0; i<events.length; i++) {
			var event = events[i];
			if (event.type == 8 || event.type == 9 || (event.type == 255 && event.metaType == 47)) 
				totalTicks += event.deltaTime;
		}
		return totalTicks;
	}
	
	toTrack(data) {		
		var midi = MidiParser.parse(data);
		var midiTrack = midi.formatType == 0 ? midi.track[0] : midi.track[1];
		var ppqn = midi.timeDivision;
		
		var track = {
			"ppqn": ppqn,
			"events": JSON.parse(JSON.stringify(midiTrack.event)),
			"length": this.getLengthTicks(midiTrack.event)
		};
		
		return track;
	}

	createGroove(type, name, data) {
		this.grooves.push({
			"type": type,
			"name": name,
			"track": this.toTrack(data)
		});
	}

	createFill(type, name, data) {
		this.fills.push({
			"type": type,
			"name": name,
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
		this.tempo = song.tempo;
		this.playingPattern = null;
		this.playingWhat = null;
		this.currentGroove = null;
		this.nextPattern = null;
		this.groovesRepeats = 0;
		this.fillsRepeats = 0;
		
		this.playEvents = this.playEvents.bind(this);
		this.onAllEventsPlayed = this.onAllEventsPlayed.bind(this);
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
			this.startPlayingPattern();
		} else {
			if (this.playingPattern == pattern.name) {
				// User requested to play the same pattern as the one currently playing.				
				// Clear next pattern, if any.
				this.nextPattern = null;
			} else {
				this.nextPattern = pattern.name;
			}
		}
	}
			
	playEvents(track, startAt, justBefore) {
		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}

		var f = 60000 / track.ppqn / this.tempo;
		var startTime = performance.now();
		var time = startTime;
		var ticks = 0;
		
		for (var i=0; i<track.events.length; i++) {
			var event = track.events[i];
			if (event.type == 8 || event.type == 9 || (event.type == 255 && event.metaType == 47)) {
				ticks += event.deltaTime;
				if (ticks < startAt)
					continue;					
				if (ticks >= justBefore)
					break;

				time += (event.deltaTime * f);
				if (event.type == 8 || event.type == 9)
					activeMidiOut.send([event.type == 8 ? 0x80 : 0x90, event.data[0], event.data[1]], time);				
			}
		}
		
		return f;
	}
	
	roundToBeat(ticks, ppqn) {
		return (Math.round(ticks / ppqn) + (ticks % ppqn == 0 ? 0 : 0)) * ppqn;
	}

	startPlayingPattern() {
		this.tempo = this.song.tempo;
		this.currentGroove = null;
		this.nextFill = null;
		
		console.log('Play pattern => ' + this.playingPattern);
		var pattern = this.song.patterns[this.playingPattern];
		this.tempo = pattern.tempo > 0 ? pattern.tempo : this.song.tempo;
		var chosenGroove = pattern.groovesMode == 'sequence' ? this.groovesRepeats % pattern.grooves.length : Math.floor(Math.random() * pattern.grooves.length);
		this.currentGroove = pattern.grooves[chosenGroove];
		if (pattern.fills.length > 0) {
			var chosenFill = pattern.fillsMode == 'sequence' ? this.fillsRepeats % pattern.fills.length : Math.floor(Math.random() * pattern.fills.length);
			this.nextFill = pattern.fills[chosenFill];
		}
		
		var grooveNoFillSectionLenght = this.nextFill ? (this.currentGroove.track.length - this.nextFill.track.length) : this.currentGroove.track.length + 1;
		var f = this.playEvents(this.currentGroove.track, 0, grooveNoFillSectionLenght);
		this.playingWhat = 'groove';
		
		this.groovesRepeats = this.groovesRepeats + 1; 
		setTimeout(this.onAllEventsPlayed, this.roundToBeat(grooveNoFillSectionLenght, this.currentGroove.track.ppqn) * f);
	}
	
	onAllEventsPlayed() {
		var lastPlayedWhat = this.playingWhat;
		this.playingWhat = null

		if (!activeMidiOut) {
			console.log('No active MIDI out port!');
			return;
		}

		if (lastPlayedWhat == 'groove') {
			var needToPlayFill = this.nextPattern && this.nextPattern != this.playingPattern;
			var fillAvailable = this.nextFill ? true : false;

			if (fillAvailable) {
				var fillSectionLengthInMillis = 0;
				var ppqn = 0;
				if (needToPlayFill) {
					ppqn = this.nextFill.track.ppqn;
					this.fillsRepeats = this.fillsRepeats + 1; 
					var f = this.playEvents(this.nextFill.track, 0, this.nextFill.track.length + 1);
					this.playingWhat = 'fill';
					fillSectionLengthInMillis = this.nextFill.track.length * f;
				} else  {
					ppqn = this.currentGroove.track.ppqn;
					var f = this.playEvents(this.currentGroove.track, 
						this.currentGroove.track.length - (this.nextFill.track.length + 1),
						this.currentGroove.track.length + 1);
					this.playingWhat = 'remainder';
					fillSectionLengthInMillis = this.nextFill.track.length * f;
				}				
				setTimeout(this.onAllEventsPlayed, this.roundToBeat(fillSectionLengthInMillis, ppqn));
				this.nextFill = null;
			} // if no fill is available, all of the current groove events have already been played.			
		} else if (lastPlayedWhat == 'fill' || lastPlayedWhat == 'remainder') {		
			if (this.nextPattern) {
				this.groovesRepeats = 0;
				this.fillsRepeats = 0;
				
				console.log('To next pattern => ' + this.nextPattern);
				
				this.playingPattern = this.nextPattern;
				this.nextPattern = null;
			} else if (this.playingPattern) {
				console.log('Repeat pattern => ' + this.playingPattern);
			}
			
			if (this.playingPattern)
				this.startPlayingPattern();
		}
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
