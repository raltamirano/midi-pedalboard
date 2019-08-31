class Pattern {
	constructor(name) {
		this.name = name;
		this.tempo = 0;
		this.groovesMode = 'sequence';
		this.fillsMode = 'sequence';
		this.grooves = {};
		this.fills = {};
	};	
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



var activeMidiIn = null;
var song = new Song();

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
	});
}	

function loadSong() {
	$('#songTitle').val(song.title);
	$('#songTempo').val(song.tempo);

	var patterns = $('#editingPattern');
	patterns.empty();
	for (patternName in song.patterns)
		patterns.append($("<option />").val(patternName).text(patternName));
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
	playPattern(pedal);
}
  
function playPattern(id) {
	var portID = $('#midiOuts').val();
	var output = window.ma.outputs.get(portID);
	
  
	var player = new MidiPlayer.Player();
	
	player.on('playing', function(currentTick) {
		console.log('Playing at tick: ' + JSON.stringify(currentTick));
	});
	
	player.on('midiEvent', function(event) {
		console.log('MIDI event: ' + JSON.stringify(event));

		var eventType = null;
	
		if (event.name == 'Note on') 
			eventType = 0x90;
		else if (event.name == 'Note off') 
			eventType = 0x80;
		
		if (eventType)
			output.send([eventType, event.noteNumber, event.velocity]);
	});
	
	var patternB64 = 'data:audio/midi;base64,TVRoZAAAAAYAAQACAeBNVHJrAAAAWAD/AihDb3B5cmlnaHQgKGMpIDIwMTIgUHJvc29uaWMgU3R1ZGlvcywgTExDAP9YBAQCGAgA/wMcQlJuUiA0LTQgTm1sU3RyIFQwMjMgRnVsbEtpdAD/LwBNVHJrAAADqAD/AyBCUm5SXzQtNF9ObWxTdHJfVDAyM19GdWxsS2l0XzAwNACZJFYBmSpgAJkmWByZJAAAmSYAAJkqAFyZJi4cmSYAXZkmPwCZKkkbmSoAAJkmAFiZJEUCmSYyHpkmAACZJABdmSZWAJkqZhuZJgAAmSoAWZkmLx+ZJgBYmSY/AZkkVQKZKkgdmSQAAJkqAACZJgBcmSYuHJkmAFmZKmMFmSZXAJkkWBqZJAAAmSoAAJkmAFmZJi8fmSYAV5kuSQOZJj4emS4AAJkmAF2ZJi8bmSYAWZkqYgGZJlkemSYAAJkqAFmZJjEfmSYAWZkpWAOZKkgCmSY9GpkqAACZKQAAmSYAWZkmKx+ZJgBamSZXA5kqZgCZJFsbmSQAAJkmAACZKgBXmSYxIZkmAFqZKksCmSlaAJkmPxyZKQAAmSoAAJkmAFmZJEgBmSYvHpkkAACZJgBYmSpjAZkmVwWZKVcamSYAAJkqAACZKQBYmSYvIJkmAFmZKkoAmSZDBZkkVhqZKgAAmSQAAJkmAF6ZJiwamSYAV5kmXAKZJFYBmSpgHpkmAACZJAAAmSoAXZkmLBuZJgBZmSpJA5kmQRyZKgAAmSYAXpkmKxqZJgBcmSpiAJkmWByZJgAAmSoAXZkmLRuZJgBYmSZDBJkuSRyZJgAAmS4AXpkmLxqZJgBXmSpgA5kmWwOZJFkbmSoAAJkkAACZJgBXmSYxIZkmAFyZJkABmSpNG5kqAACZJgBXmSRCBpkmMhuZJAAAmSYAWZkmWQGZKmYemSoAAJkmAFyZJEMBmSYuG5kkAACZJgBbmSpJAJkmPgKZJFQbmSQAAJkqAACZJgBcmSYvHJkmAFyZJlYBmSRUAZkqYxqZKgAAmSYAAJkkAFyZJiscmSYAWZkqTQKZJkAdmSoAAJkmAFeZJjIhmSYAWJkqYASZJlocmSoAAJkmAF6ZJi4amSYAV5kpUwGZKk4EmSY+HJkqAACZJgAAmSkAXZkmLBuZJgBcmSRaAZkmWBuZJAAAmSYAWJkmKyCZJgBcmSlaApkmRBqZKQAAmSYAV5kkRwOZJisemSYAAJkkAFyZKVgBmSZWG5kpAACZJgBYmSRHA5kmLB2ZJgAAmSQAXZkmPQGZJFYamSYAAJkkAFqZJjAemSYAW5kmWQKZJFsbmSQAAJkmAFuZJjAdmSYAW5kmQh2ZJgBcmSYrHJkmAFyZJl0cmSYAW5kmLB2ZJgBXmSY9IZkmAFqZJi4emSYAW/8vAA==';
	player.loadDataUri(patternB64);
	player.setTempo(parseInt(document.getElementById('songTempo').value));
	player.play();
}
  
function playNote(note) {
	var portID = $('#midiOuts').val();
	var noteOnMessage  = [0x90, note, 127]; 
	var noteOffMessage = [0x80, note, 127]; 
	var output = window.ma.outputs.get(portID);
	output.send(noteOnMessage);  
	setTimeout(() => output.send(noteOffMessage), 500)
}
  
function parseMidiMessage(message) {
	return {
		command: message.data[0] >> 4,
		channel: message.data[0] & 0xf,
		note: message.data[1],
		velocity: message.data[2] / 127
	}
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
	
	alert('add groove to pattern: ' + editingPatternName);
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


		
