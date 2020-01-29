'use strict';
import NestedInputComponent from './NestedInputComponent';
import Harness from '../../../../test/harness';

let component = null;
describe('NestedInputComponent class', () => {
  it('Should create a new NestedInputComponent class', () => {
    return Harness.testCreate(NestedInputComponent, {
      // key: 'nested',
      components: [
        {
          type: 'textfield',
          key: 'firstName',
          input: true
        },
        {
          type: 'textfield',
          key: 'lastName',
          input: true
        }
      ]
    }).then((_component) => {
      component = _component;
      Harness.testElements(component, 'input[name="data[firstName]"]', 1);
      Harness.testElements(component, 'input[name="data[lastName]"]', 1);
    });
  });
});