import Field from './../../components/_classes/field/Field';
import NativePromise from 'native-promise-only';
import getModes from './Sketchpad.modes';
import toolbarButtons from './Sketchpad.toolbar.buttons';
import Formio from '../../Formio';
import Two from 'two.js';
import Picker from 'vanilla-picker';
import _ from 'lodash';

export default class Sketchpad extends Field {
  useBackgroundDimensions;
  state;
  modes;
  dimensionsMultiplier;
  zoomInfo;
  layers;
  deleted;

  static schema(...extend) {
    return Field.schema({
      type: 'sketchpad',
      label: 'Sketchpad',
      key: 'sketchpad',
      input: true,
      modalEdit: false,
      imageType: 'image',
      defaultZoom: 100,
      defaultStroke: '#333',
      defaultFill: '#ccc',
      defaultLineWidth: 1,
      defaultCircleSize: 10
    }, ...extend);
  }

  static get builderInfo() {
    return {
      title: 'Sketchpad',
      group: 'advanced',
      icon: 'image',
      weight: 110,
      documentation: 'http://help.form.io/userguide/', //TODO add documentation link
      schema: Sketchpad.schema()
    };
  }

  constructor(...args) {
    super(...args);
    const backgroundReadyPromise = new NativePromise((resolve, reject) => {
      this.backgroundReady = { resolve, reject };
    });
    this.backgroundReady.promise = backgroundReadyPromise;

    this.modes = getModes.call(this, Two);

    this.state = {
      mode: Object.keys(this.modes)[0],
      stroke: this.component.defaultStroke,
      fill: this.component.defaultFill,
      linewidth: this.component.defaultLineWidth,
      circleSize: this.component.defaultCircleSize
    };

    this.dimensionsMultiplier = 1;
    this.zoomInfo = {
      viewBox: {},
      multiplier: 1.5,
      totalMultiplier: 1
    };

    this.deleted = [];
    this.layers = [];
  }

  render() {
    return super.render(this.renderTemplate(this.templateName, {
      ...this.renderContext
    }));
  }

  init() {}

  attach(element) {
    this.loadRefs(element, {
      canvas: 'single',
      background: 'single',
      ...this.buttonsRefs
    });

    if (this.refs.canvas) {
      this.createDrawingArea();
      this.addEventListener(window, 'resize', _.debounce(() => this.stretchDrawingArea(), 100));
      this.attachDrawEvents();

      if (this.refs.image && !this.imageWasLoaded) {
        this.refs.image.addEventListener('load', e => {
          this.originalImage = { width: e.target.width, height: e.target.height };
          this.imageWasLoaded = true;
          this.addBackground();
        });
      }
      else {
        this.addBackground();
      }

      this.attachToolbar();
    }
  }

  get buttonsRefs() {
    const refsConfig = {};
    Object.values(toolbarButtons).forEach(buttonsGroup => buttonsGroup.forEach(button => {
      refsConfig[button.key] = 'single';
      if (button.input) {
        refsConfig[`${button.key}-input`] ='single';
      }
    }));
    return refsConfig;
  }

  get renderContext() {
    return {
      zoomInfo: this.zoomInfo || {
        viewBox: {},
        multiplier: 1.5,
        totalMultiplier: 1
      },
      buttonGroups: this.buttonGroups
    };
  }

  get defaultSchema() {
    return Sketchpad.schema();
  }

  get templateName() {
    return 'sketchpad';
  }

  get emptyValue() {
    return [];
  }

  get useBackgroundDimensions() {
    return !this.component.width || !this.component.height;
  }

  get attachFunctions() {
    const setColor = (element, color, onChange) => {
      const picker = new Picker(element);
        element.style.color = color;
        picker.setColor(color, true);
        picker.onChange = (newColor) => {
          element.style.color = newColor.rgbaString;
          onChange(newColor.rgbaString);
        };
        return element;
    };

    const attachInput = (key, value, onChange) => {
      const inputRef = this.refs[key];
      if (inputRef) {
        inputRef.addEventListener('change', e => onChange(e.target.value));
        inputRef.value = value;
      }
    };

    return {
      stroke: (element) => setColor(element, this.state.stroke, (color) => this.state.stroke = color),
      fill: (element) => setColor(element, this.state.fill, (color) => this.state.fill = color),
      width: (element) => attachInput('width-input', this.state.linewidth, (lineWidth) => this.state.linewidth = lineWidth),
      circle: (element) => attachInput('circle-input', this.state.circleSize, (circleSize) => this.state.circleSize = circleSize)
    };
  }

  get buttonGroups() {
    return Object.entries(toolbarButtons).map(([gruop, buttons]) => buttons);
  }

  createDrawingArea() {
    this.two = new Two({ type: Two.Types.svg }).appendTo(this.refs.canvas);
    this.canvasSvg = this.two.renderer.domElement;
    this.addClass(this.canvasSvg, 'formio-sketchpad-svg');
    this.canvasSvg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
  }

  getActualCoordinate(coordinate) {
    // recalculate coordinate taking into account changed size of drawing area
    coordinate.x = Math.round(coordinate.x / this.dimensionsMultiplier) + this.dimensions.minX;
    coordinate.y = Math.round(coordinate.y / this.dimensionsMultiplier) + this.dimensions.minY;
    return coordinate;
  }

  addBackground() {
    this.backgroundReady.promise.then(() => this.backgroundReady.isReady = true);
    if (this.refs.image && this.refs.image.complete && !this.imageWasLoaded) {
      this.imageWasLoaded = true;
      this.originalImage = this.refs.image;
      return;
    }
    else if (this.refs.image && this.refs.image.complete && this.imageWasLoaded) {
      this.setBackgroundImage();
    }
    else if (this.component.imageUrl) {
      Formio.makeStaticRequest(this.component.imageUrl, 'GET', null, { noToken: true, headers: {} })
      .then(image => {
        this.setBackgroundImage(image);
      })
      .catch(() => {
        //TODO check that component works in this case anyway
        this.refs.background.innerHTML = this.t('Background image failed to load. Tagpad doesn\'t work without background image');
        this.backgroundReady.resolve();
      });
    }
  }

  setSvgImage(svgMarkup) {
    const xmlDoc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    let backgroundSvg = xmlDoc.getElementsByTagName('svg');
    if (!backgroundSvg || !backgroundSvg[0]) {
      console.warn(`Sketchpad '${this.component.key}': Background SVG doesn't contain <svg> tag on it`);
      return;
    }
    backgroundSvg = backgroundSvg[0];
    //read initial dimensions from viewBox
    const initialViewBox = backgroundSvg.getAttribute('viewBox');

    if (initialViewBox) {
      this.setDimensions(...initialViewBox.split(' ').map(parseFloat));
    }
    else {
      this.setDimensions(...this.mapDimensionsFromAttributes(backgroundSvg));
    }

    //remove width and height attribute for background image to be stretched to available width and preserve aspect ratio
    backgroundSvg.removeAttribute('width');
    backgroundSvg.removeAttribute('height');

    const viewBox = this.dimensions;
    //set initial zoom info for SVG
    this.zoomInfo.viewBox.default = {
      width: viewBox.width,
      height: viewBox.height,
      minX: viewBox.minX,
      minY: viewBox.minY
    };
    //set current zoom to default
    this.zoomInfo.viewBox.current = _.cloneDeep(this.zoomInfo.viewBox.default);

    //set background image viewBox
    backgroundSvg.setAttribute('viewBox', `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
    //set canvas image viewBox (necessary for canvas SVG to stretch properly without losing correct aspect ration)
    this.canvasSvg.setAttribute('viewBox', `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);

    svgMarkup = new XMLSerializer().serializeToString(backgroundSvg);
    //fix weird issue in Chrome when it returned '<svg:svg>...</svg:svg>' string after serialization instead of <svg>...</svg>
    svgMarkup = svgMarkup.replace('<svg:svg', '<svg').replace('</svg:svg>', '</svg>');

    this.refs.background.innerHTML = svgMarkup;
  }

  attachDrawEvents() {
    this.canvasSvg
      .addEventListener('mousedown', (e) => {
        e.preventDefault();
        const offset = this.canvasSvg.getBoundingClientRect();
        //change cursor
        let cursor = 'default';
        if (this.modes[this.state.mode].cursor) {
          cursor = this.modes[this.state.mode].cursor.clicked || this.modes[this.state.mode].cursor.hover;
        }
        this.canvasSvg.style.cursor = cursor;
        if (this.modes[this.state.mode].eventStart) {
          this.modes[this.state.mode].eventStart(this.getActualCoordinate({
            x: e.clientX - offset.left,
            y: e.clientY - offset.top
          }));
        }

        const mouseDrag = (e) => {
          e.preventDefault();
          const offset = this.canvasSvg.getBoundingClientRect();
          if (this.modes[this.state.mode].drag) {
            this.modes[this.state.mode].drag(this.getActualCoordinate({
              x: e.clientX - offset.left,
              y: e.clientY - offset.top
            }));
          }
        };

        const mouseEnd = (e) => {
          e.preventDefault();

          this.canvasSvg.removeEventListener('mousemove', mouseDrag);
          this.canvasSvg.removeEventListener('mouseup', mouseEnd);
          document.removeEventListener('mouseup', mouseEnd);
          //change cursor
          let cursor = 'default';
          if (this.modes[this.state.mode].cursor) {
            cursor = this.modes[this.state.mode].cursor.hover || cursor;
          }
          this.canvasSvg.style.cursor = cursor;
          const offset = this.canvasSvg.getBoundingClientRect();
          if (this.modes[this.state.mode].eventEnd) {
            this.modes[this.state.mode].eventEnd(this.getActualCoordinate({
              x: e.clientX - offset.left,
              y: e.clientY - offset.top
            }));
          }
        };

        this.canvasSvg.addEventListener('mousemove', mouseDrag);
        this.canvasSvg.addEventListener('mouseup', mouseEnd);
        //this is necessary to stop drawing after mouse is up outside of canvas
        document.addEventListener('mouseup', mouseEnd);

        return false;
      });

    // Set up touch events.
    this.canvasSvg
      .addEventListener('touchstart', (e) => {
        e.preventDefault();

        const offset = this.canvasSvg.getBoundingClientRect();
        const touch = e.changedTouches[0];
        //change cursor
        let cursor = 'default';
        if (this.modes[this.state.mode].cursor) {
          cursor = this.modes[this.state.mode].cursor.clicked || this.modes[this.state.mode].cursor.hover;
        }
        this.canvasSvg.style.cursor = cursor;
        if (this.modes[this.state.mode].eventStart) {
          this.modes[this.state.mode].eventStart(this.getActualCoordinate({
            x: touch.pageX - offset.left,
            y: touch.pageY - offset.top
          }));
        }

        const touchDrag = (e) => {
          e.preventDefault();

          const offset = this.canvasSvg.getBoundingClientRect();
          const touch = e.changedTouches[0];
          if (this.modes[this.state.mode].drag) {
            this.modes[this.state.mode].drag(this.getActualCoordinate({
              x: touch.pageX - offset.left,
              y: touch.pageY - offset.top
            }));
          }
        };

        const touchEnd = (e) => {
          e.preventDefault();

          this.canvasSvg
            .removeEventListener('touchmove', touchDrag);
          this.canvasSvg
            .removeEventListener('touchend', touchEnd);

          const offset = this.canvasSvg.getBoundingClientRect();
          const touch = e.changedTouches[0];
          //change cursor
          let cursor = 'default';
          if (this.modes[this.state.mode].cursor) {
            cursor = this.modes[this.state.mode].cursor.hover || cursor;
          }
          this.canvasSvg.style.cursor = cursor;
          if (this.modes[this.state.mode].eventEnd) {
            this.modes[this.state.mode].eventEnd(this.getActualCoordinate({
              x: touch.pageX - offset.left,
              y: touch.pageY - offset.top
            }));
          }
        };

        this.canvasSvg
          .addEventListener('touchmove', touchDrag);

        this.canvasSvg
          .addEventListener('touchend', touchEnd);

        return false;
      });

    this.two.update();
  }

  attachToolbar() {
    this.attachModesButtons();
    this.attachStylesButtons();
    this.attachActionsButtons();
  }

  attachModesButtons() {
    toolbarButtons.modes.forEach(mode => {
      const buttonRef = this.refs[mode.key];

      if (buttonRef && this.modes[mode.key]) {
        const modeConfig = this.modes[mode.key];
        buttonRef.addEventListener('click', e => this.setState(modeConfig.state));
        this.callAttachFunction(buttonRef, mode.key);
      }
    });
  }

  attachStylesButtons() {
    toolbarButtons.styles.forEach(style => {
      const buttonRef = this.refs[style.key];

      if (buttonRef) {
        this.callAttachFunction(buttonRef, style.key);
      }
    });
  }

  attachActionsButtons() {
    toolbarButtons.actions.forEach(action => {
      const buttonRef = this.refs[action.key];

      if (buttonRef) {
        buttonRef.addEventListener('click', () => this[action.key]());
      }
    });
  }

  callAttachFunction(element, key) {
    if (this.attachFunctions[key]) {
      this.attachFunctions[key](element);
    }
  }

  setState(state) {
    Object.assign(this.state, state);
    this.setActiveButton(this.state.mode);
    //change cursor
    this.canvasSvg.style.cursor = _.get(this.modes[this.state.mode], 'cursor.hover', 'default');
  }

  setActiveButton(mode) {
    toolbarButtons.modes.forEach(modeButton => {
      this.refs[modeButton.key] &&  this.removeClass(this.refs[modeButton.key], 'active');
      this.refs[mode] && this.addClass(this.refs[mode], 'active');
    });
  }

  setBackgroundImage(image) {
    if (image && image.startsWith('<?xml')) {
      this.imageType = 'svg';
      this.setSvgImage(image);
    }
    else {
      this.imageType = 'image';
      const viewBoxWidth = this.originalImage.width;
      const viewBoxHeight = this.originalImage.height;

      this.canvasSvg.setAttribute('viewBox', `0 0 ${viewBoxWidth} ${viewBoxHeight}`);
      this.setDimensions( 0, 0, viewBoxWidth, viewBoxHeight);
    }

    this.stretchDrawingArea();
    this.backgroundReady.resolve();
  }

  mapDimensionsFromAttributes(svg) {
    return [
        { attribute: 'x', defaultValue: 0 },
        { attribute: 'y', defaultValue: 0 },
        { attribute: 'width', defaultValue: 640 },
        { attribute: 'height', defaultValue: 480 }
      ].map(dimension => {
        return parseFloat(svg.getAttribute(dimension.attribute)) || dimension.defaultValue;
      });
  }

  setDimensions(viewBoxMinX, viewBoxMinY, viewBoxWidth, viewBoxHeight) {
    this.dimensions = {
      width: viewBoxWidth,
      height: viewBoxHeight,
      minX: viewBoxMinX,
      minY: viewBoxMinY
    };
  }

  stretchDrawingArea() {
    const width = this.refs.background.offsetWidth;
    const height = this.refs.background.offsetHeight;
    //don't stretch if background dimensions are unknown yet
    if (width && height) {
      //will need dimensions multiplier for coordinates calculation
      this.dimensionsMultiplier = width / this.dimensions.width;
      this.setEditorSize(width, height);
    }
  }

  setEditorSize(width, height) {
    this.two.width = width;
    this.two.height = height;
    this.two.update();

    //TODO change canvasSvg size and backgroundSize
  }

  clear() {
    this.two.clear();
  }

  clearAll() {
    this.layers = [];
    this.dataValue = [];
    this.clear();
    this.two.update();
  }

  draw(value) {
    this.clear();
    this.layers = value.map(item => this.modes[item.mode].draw(item));
    this.two.update();
  }

  undo() {
    const value = this.dataValue.slice();
    if (!value.length) {
      return;
    }
    this.deleted.push(value.pop());
    this.dataValue = value;
    this.triggerChange();
    this.draw(value);
  }

  redo() {
     if (!this.deleted.length) {
      return;
    }
    const value = this.dataValue.slice();
    value.push(this.deleted.pop());
    this.dataValue = value;
    this.triggerChange();
    this.draw(value);
  }

  setValue(value) {
    if (!this.backgroundReady.isReady || !this.two) {
      return;
    }
    this.draw(value);
  }

  //TODO use it for modalEdit preview template
  getSvg() {
    //clone view SVG element from editor
    const svgElement = this.canvasSvg.cloneNode(true);
    //make view SVG responsive: remove height and width attribute, add viewBox attribute
    svgElement.removeAttribute('height');
    svgElement.removeAttribute('width');
    svgElement.style.cursor = 'pointer';
    //set viewBox to default to reset zoom
    const viewBox = this.zoomInfo.viewBox.default;
    svgElement.setAttribute('viewBox', `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
    return svgElement;
  }

  normalizeSvgOffset() {
    /* eslint-disable max-len */
    //don't let offset go out of SVG on the left and on the top
    //canvas
    this.zoomInfo.viewBox.current.minX = this.zoomInfo.viewBox.current.minX < this.zoomInfo.viewBox.default.minX ? this.zoomInfo.viewBox.default.minX : this.zoomInfo.viewBox.current.minX;
    this.zoomInfo.viewBox.current.minY = this.zoomInfo.viewBox.current.minY < this.zoomInfo.viewBox.default.minY ? this.zoomInfo.viewBox.default.minY : this.zoomInfo.viewBox.current.minY;
    //don't let offset go out of SVG on the right and on the bottom
    //canvas
    const canvasMaxOffsetX = this.zoomInfo.viewBox.default.width - this.zoomInfo.viewBox.current.width + this.zoomInfo.viewBox.default.minX;
    const canvasMaxOffsetY = this.zoomInfo.viewBox.default.height - this.zoomInfo.viewBox.current.height + this.zoomInfo.viewBox.default.minY;
    this.zoomInfo.viewBox.current.minX = this.zoomInfo.viewBox.current.minX > (canvasMaxOffsetX) ? canvasMaxOffsetX : this.zoomInfo.viewBox.current.minX;
    this.zoomInfo.viewBox.current.minY = this.zoomInfo.viewBox.current.minY > (canvasMaxOffsetY) ? canvasMaxOffsetY : this.zoomInfo.viewBox.current.minY;
    /* eslint-enable max-len */
  }

  updateSvgViewBox() {
    //set viewBox so that SVG gets zoomed to the proper area according to zoomInfo
    const viewBox = this.zoomInfo.viewBox.current;
    this.canvasSvg.setAttribute('viewBox', `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`);
    // this.refs.background.svg.setAttribute('viewBox', `${viewBox.minX} ${viewBox.minY} ${viewBox.width} ${viewBox.height}`); //TODO set view box for background
  }

  dragImage(offset) {
    //calculate new offsets for SVG
    this.zoomInfo.viewBox.current.minX = this.zoomInfo.viewBox.current.minX - offset.x;
    this.zoomInfo.viewBox.current.minY = this.zoomInfo.viewBox.current.minY - offset.y;
    this.normalizeSvgOffset();
    this.updateSvgViewBox();
  }

  setTotalMultiplier(multiplier) {
    this.zoomInfo.totalMultiplier = multiplier;
    // this.refs.totalMultiplier.innerHTML = this.t(Math.round(multiplier * 100) / 100);
  }
}